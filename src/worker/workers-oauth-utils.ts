// Consent and CSRF helpers for the worker's /authorize flow, adapted from
// Cloudflare's remote-mcp OAuth reference. Provider-agnostic.
//
// - The approval form carries a CSRF token that must match a cookie.
// - The upstream OAuth state lives in KV and is bound to the browser by a
//   cookie holding its SHA-256 hash, so a stolen state link fails elsewhere.
// - Approved client ids live in an HMAC-signed cookie, so a returning user
//   skips the dialog only for clients they approved.

import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";

const CSRF_COOKIE = "__Host-CSRF_TOKEN";
const STATE_COOKIE = "__Host-CONSENTED_STATE";
const APPROVED_COOKIE = "__Host-APPROVED_CLIENTS";
const TEN_MINUTES = 600;
const THIRTY_DAYS = 2_592_000;

/** An OAuth 2.1 error that renders as a JSON error response. */
export class OAuthError extends Error {
	constructor(
		public code: string,
		public description: string,
		public statusCode = 400
	) {
		super(description);
		this.name = "OAuthError";
	}

	toResponse(): Response {
		return Response.json(
			{ error: this.code, error_description: this.description },
			{ status: this.statusCode }
		);
	}
}

function cookie(name: string, value: string, maxAge: number): string {
	return `${name}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

function readCookie(request: Request, name: string): string | null {
	for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
		const entry = part.trim();
		if (entry.startsWith(`${name}=`)) return entry.slice(name.length + 1);
	}
	return null;
}

function toHex(bytes: ArrayBuffer): string {
	return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string): Promise<string> {
	return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Escapes text for HTML element content and quoted attributes. */
export function sanitizeText(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/** Returns the URL if it is http(s) with no control characters, else "". */
export function sanitizeUrl(url: string): string {
	const normalized = url.trim();
	// RFC 3986 excludes control characters (C0, DEL and C1).
	const control = (c: string) => c <= "\u001f" || (c >= "\u007f" && c <= "\u009f");
	if ([...normalized].some(control)) return "";
	try {
		const { protocol } = new URL(normalized);
		return protocol === "https:" || protocol === "http:" ? normalized : "";
	} catch {
		return "";
	}
}

export function generateCSRFProtection(): { token: string; setCookie: string } {
	const token = crypto.randomUUID();
	return { token, setCookie: cookie(CSRF_COOKIE, token, TEN_MINUTES) };
}

/** Throws unless the form's CSRF token matches the cookie. */
export function validateCSRFToken(formData: FormData, request: Request): { clearCookie: string } {
	const fromForm = formData.get("csrf_token");
	if (!fromForm || typeof fromForm !== "string") {
		throw new OAuthError("invalid_request", "Missing CSRF token in form data");
	}
	const fromCookie = readCookie(request, CSRF_COOKIE);
	if (!fromCookie) throw new OAuthError("invalid_request", "Missing CSRF token cookie");
	if (fromForm !== fromCookie) throw new OAuthError("invalid_request", "CSRF token mismatch");
	return { clearCookie: cookie(CSRF_COOKIE, "", 0) };
}

/** Stores the client's request in KV under a fresh upstream state token. */
export async function createOAuthState(
	oauthReqInfo: AuthRequest,
	kv: KVNamespace
): Promise<{ stateToken: string }> {
	const stateToken = crypto.randomUUID();
	await kv.put(`oauth:state:${stateToken}`, JSON.stringify(oauthReqInfo), {
		expirationTtl: TEN_MINUTES,
	});
	return { stateToken };
}

/** Binds a state token to this browser with a cookie holding its hash. */
export async function bindStateToSession(stateToken: string): Promise<{ setCookie: string }> {
	return { setCookie: cookie(STATE_COOKIE, await sha256Hex(stateToken), TEN_MINUTES) };
}

/**
 * Checks the callback's state against KV and the browser's binding cookie,
 * then deletes it so it cannot be replayed.
 */
export async function validateOAuthState(
	request: Request,
	kv: KVNamespace
): Promise<{ oauthReqInfo: AuthRequest; clearCookie: string }> {
	const state = new URL(request.url).searchParams.get("state");
	if (!state) throw new OAuthError("invalid_request", "Missing state parameter");

	const stored = await kv.get(`oauth:state:${state}`);
	if (!stored) throw new OAuthError("invalid_request", "Invalid or expired state");

	const boundHash = readCookie(request, STATE_COOKIE);
	if (!boundHash) {
		throw new OAuthError(
			"invalid_request",
			"Missing session binding cookie - authorization flow must be restarted"
		);
	}
	if ((await sha256Hex(state)) !== boundHash) {
		throw new OAuthError(
			"invalid_request",
			"State token does not match session - possible CSRF attack detected"
		);
	}

	let oauthReqInfo: AuthRequest;
	try {
		oauthReqInfo = JSON.parse(stored);
	} catch {
		throw new OAuthError("server_error", "Invalid state data", 500);
	}
	await kv.delete(`oauth:state:${state}`);
	return { oauthReqInfo, clearCookie: cookie(STATE_COOKIE, "", 0) };
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	if (!secret) throw new Error("cookieSecret is required for signing cookies");
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"]
	);
}

/** Reads the approved client ids, or null if the cookie is missing or its signature is wrong. */
async function approvedClients(request: Request, secret: string): Promise<string[] | null> {
	const [signature, payload, ...rest] = readCookie(request, APPROVED_COOKIE)?.split(".") ?? [];
	if (!signature || !payload || rest.length || !/^([0-9a-f]{2})+$/.test(signature)) return null;
	try {
		const json = atob(payload);
		const bytes = new Uint8Array(signature.match(/../g)?.map((byte) => parseInt(byte, 16)) ?? []);
		const key = await hmacKey(secret);
		if (!(await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(json)))) {
			return null;
		}
		const ids: unknown = JSON.parse(json);
		return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? ids : null;
	} catch {
		return null;
	}
}

export async function isClientApproved(
	request: Request,
	clientId: string,
	cookieSecret: string
): Promise<boolean> {
	return (await approvedClients(request, cookieSecret))?.includes(clientId) ?? false;
}

/** Returns a Set-Cookie value that adds the client to the signed approval list. */
export async function addApprovedClient(
	request: Request,
	clientId: string,
	cookieSecret: string
): Promise<string> {
	const existing = (await approvedClients(request, cookieSecret)) ?? [];
	const payload = JSON.stringify([...new Set([...existing, clientId])]);
	const key = await hmacKey(cookieSecret);
	const signature = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
	return cookie(APPROVED_COOKIE, `${signature}.${btoa(payload)}`, THIRTY_DAYS);
}

export interface ApprovalDialogOptions {
	client: ClientInfo | null;
	server: { name: string; logo?: string; description?: string };
	state: { oauthReqInfo: AuthRequest };
	csrfToken: string;
	setCookie: string;
}

/** The consent page. Every client-supplied value is escaped, and URLs must be http(s). */
export function renderApprovalDialog(request: Request, options: ApprovalDialogOptions): Response {
	const { client, server, state, csrfToken, setCookie } = options;
	const safeUrl = (url?: string) => sanitizeText(sanitizeUrl(url ?? ""));

	const serverName = sanitizeText(server.name);
	const clientName = client?.clientName ? sanitizeText(client.clientName) : "Unknown MCP Client";
	const logo = safeUrl(server.logo);
	const website = safeUrl(client?.clientUri);
	const redirects = (client?.redirectUris ?? []).map(safeUrl).filter(Boolean);

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${clientName} | Authorization Request</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 36rem; margin: 2rem auto; padding: 0 1rem; color: #222; }
  header { display: flex; align-items: center; gap: 1rem; }
  header img { width: 48px; height: 48px; }
  dt { font-weight: 600; }
  dd { margin: 0 0 0.75rem; font-family: ui-monospace, monospace; word-break: break-all; }
  button { padding: 0.75rem 1.5rem; border: 0; border-radius: 6px; background: #f50; color: #fff; font-size: 1rem; cursor: pointer; }
</style>
</head>
<body>
<header>${logo ? `<img src="${logo}" alt="">` : ""}<h1>${serverName}</h1></header>
${server.description ? `<p>${sanitizeText(server.description)}</p>` : ""}
<h2>${clientName} is requesting access</h2>
<dl>
  <dt>Name</dt><dd>${clientName}</dd>
  ${website ? `<dt>Website</dt><dd><a href="${website}" rel="noopener noreferrer">${website}</a></dd>` : ""}
  ${redirects.length ? `<dt>Redirect URIs</dt><dd>${redirects.join("<br>")}</dd>` : ""}
</dl>
<p>Approve to continue to SoundCloud.</p>
<form method="post" action="${sanitizeText(new URL(request.url).pathname)}">
  <input type="hidden" name="state" value="${btoa(JSON.stringify(state))}">
  <input type="hidden" name="csrf_token" value="${csrfToken}">
  <button type="submit">Approve</button>
</form>
</body>
</html>`;

	return new Response(html, {
		headers: {
			"Content-Security-Policy": "frame-ancestors 'none'",
			"Content-Type": "text/html; charset=utf-8",
			"Set-Cookie": setCookie,
			"X-Frame-Options": "DENY",
		},
	});
}
