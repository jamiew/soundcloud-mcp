import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { API_BASE } from "../client.js";
import { ICON_SVG } from "../icon.js";
import type { SoundCloudUser } from "../types.js";
import { landingPage } from "./landing.js";
import {
	exchangeCode,
	generatePkce,
	getAuthorizeUrl,
	isAccountAllowed,
	type Props,
	type Tokens,
} from "./oauth.js";
import {
	addApprovedClient,
	bindStateToSession,
	createOAuthState,
	generateCSRFProtection,
	isClientApproved,
	OAuthError,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
} from "./workers-oauth-utils.js";

type Bindings = Env & { OAUTH_PROVIDER: OAuthHelpers };

const app = new Hono<{ Bindings: Bindings }>();

const SERVER_INFO = {
	name: "SoundCloud MCP Server",
	description:
		"A remote MCP server that lets an AI assistant search SoundCloud and manage your library, playlists, and follows.",
	logo: "https://developers.soundcloud.com/assets/logo_big_white-65c2b096da68dd533db18b9f07eabc30.png",
};

// PKCE is mandatory on SoundCloud, so the verifier generated at /authorize has
// to survive until /callback. It is keyed by the same state token the OAuth
// state is stored under, and expires with it.
const PKCE_TTL_SECONDS = 600;

async function savePkce(kv: KVNamespace, stateToken: string, verifier: string): Promise<void> {
	await kv.put(`oauth:pkce:${stateToken}`, verifier, { expirationTtl: PKCE_TTL_SECONDS });
}

async function takePkce(kv: KVNamespace, stateToken: string): Promise<string | null> {
	const key = `oauth:pkce:${stateToken}`;
	const verifier = await kv.get(key);
	if (verifier) await kv.delete(key);
	return verifier;
}

/** Starts the upstream flow: stores the PKCE verifier, then redirects. */
async function redirectToSoundCloud(
	c: { env: Bindings; req: { url: string } },
	stateToken: string,
	headers: Record<string, string> = {}
): Promise<Response> {
	const { codeVerifier, codeChallenge } = await generatePkce();
	await savePkce(c.env.OAUTH_KV, stateToken, codeVerifier);
	return new Response(null, {
		status: 302,
		headers: {
			...headers,
			location: getAuthorizeUrl({
				clientId: c.env.SOUNDCLOUD_CLIENT_ID,
				redirectUri: new URL("/callback", c.req.url).href,
				state: stateToken,
				codeChallenge,
			}),
		},
	});
}

app.get("/", (c) =>
	c.html(landingPage(new URL(c.req.url).origin), 200, {
		// Short, so a deploy's changes show up promptly.
		"Cache-Control": "public, max-age=300",
	})
);

app.get("/icon.svg", (c) =>
	c.body(ICON_SVG, 200, {
		"Content-Type": "image/svg+xml",
		"Cache-Control": "public, max-age=86400",
	})
);

app.get("/authorize", async (c) => {
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		return c.text("Invalid request", 400);
	}

	// Skip the approval dialog for clients the user already approved.
	if (await isClientApproved(c.req.raw, clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
		const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie } = await bindStateToSession(stateToken);
		return redirectToSoundCloud(c, stateToken, { "Set-Cookie": setCookie });
	}

	const { token: csrfToken, setCookie } = generateCSRFProtection();

	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		csrfToken,
		server: SERVER_INFO,
		setCookie,
		state: { oauthReqInfo },
	});
});

app.post("/authorize", async (c) => {
	try {
		const formData = await c.req.raw.formData();

		validateCSRFToken(formData, c.req.raw);

		const encodedState = formData.get("state");
		if (!encodedState || typeof encodedState !== "string") {
			return c.text("Missing state in form data", 400);
		}

		let state: { oauthReqInfo?: AuthRequest };
		try {
			state = JSON.parse(atob(encodedState));
		} catch (_e) {
			return c.text("Invalid state data", 400);
		}

		if (!state.oauthReqInfo?.clientId) {
			return c.text("Invalid request", 400);
		}

		const approvedClientCookie = await addApprovedClient(
			c.req.raw,
			state.oauthReqInfo.clientId,
			c.env.COOKIE_ENCRYPTION_KEY
		);

		const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

		const headers = new Headers();
		headers.append("Set-Cookie", approvedClientCookie);
		headers.append("Set-Cookie", sessionBindingCookie);

		return redirectToSoundCloud(c, stateToken, Object.fromEntries(headers));
	} catch (error) {
		console.error("POST /authorize error:", error);
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		const message = error instanceof Error ? error.message : String(error);
		return c.text(`Internal server error: ${message}`, 500);
	}
});

/**
 * OAuth callback from SoundCloud. Validates state (KV + session cookie),
 * redeems the code with the stored PKCE verifier, fetches the profile, and
 * stores tokens on the issued MCP token via `props`.
 */
app.get("/callback", async (c) => {
	let oauthReqInfo: AuthRequest;
	let clearSessionCookie: string;
	const stateToken = new URL(c.req.url).searchParams.get("state") ?? "";

	try {
		const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
		oauthReqInfo = result.oauthReqInfo;
		clearSessionCookie = result.clearCookie;
	} catch (error) {
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		return c.text("Internal server error", 500);
	}

	if (!oauthReqInfo.clientId) {
		return c.text("Invalid OAuth request data", 400);
	}

	const upstreamError = c.req.query("error");
	if (upstreamError) {
		return c.text(`SoundCloud authorization failed: ${upstreamError}`, 400);
	}

	const code = c.req.query("code");
	if (!code) {
		return c.text("Missing authorization code", 400);
	}

	const codeVerifier = await takePkce(c.env.OAUTH_KV, stateToken);
	if (!codeVerifier) {
		return c.text("Login session expired — start the connection again.", 400);
	}

	let tokens: Tokens;
	try {
		tokens = await exchangeCode({
			clientId: c.env.SOUNDCLOUD_CLIENT_ID,
			clientSecret: c.env.SOUNDCLOUD_CLIENT_SECRET,
			code,
			redirectUri: new URL("/callback", c.req.url).href,
			codeVerifier,
		});
	} catch (error) {
		console.error("Token exchange error:", error);
		const message = error instanceof Error ? error.message : String(error);
		return c.text(`Token exchange failed: ${message}`, 500);
	}

	const meResp = await fetch(`${API_BASE}/me`, {
		headers: {
			Authorization: `OAuth ${tokens.accessToken}`,
			accept: "application/json; charset=utf-8",
		},
	});
	if (!meResp.ok) {
		return c.text(`Failed to fetch SoundCloud profile: ${await meResp.text()}`, 500);
	}
	const me = (await meResp.json()) as SoundCloudUser;
	if (!me?.id) {
		return c.text("SoundCloud profile response had an unexpected shape", 500);
	}

	// Gate access before issuing any token.
	if (!isAccountAllowed([me.username, String(me.id)], c.env.ALLOWED_USERS)) {
		return c.text(
			"Access denied: this SoundCloud account is not authorized to use this server.",
			403
		);
	}

	const props: Props = {
		userId: String(me.id),
		username: me.username ?? String(me.id),
		accessToken: tokens.accessToken,
		refreshToken: tokens.refreshToken,
		expiresAt: tokens.expiresAt,
	};

	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		metadata: { label: props.username },
		props,
		request: oauthReqInfo,
		scope: oauthReqInfo.scope,
		userId: props.userId,
	});

	const headers = new Headers({ Location: redirectTo });
	if (clearSessionCookie) {
		headers.set("Set-Cookie", clearSessionCookie);
	}

	return new Response(null, { status: 302, headers });
});

export { app as SoundCloudHandler };
