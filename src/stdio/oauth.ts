import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import {
	AUTH_BASE,
	SoundCloudAuthError,
	type SoundCloudClient,
	type TokenProvider,
} from "../client.js";
import type { OAuthTokenResponse } from "../types.js";
import { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } from "./config.js";
import { debug, logError } from "./log.js";
import { clearTokens, isExpired, loadTokens, type StoredToken, saveTokens } from "./tokenStore.js";

/** Tools return this message as is, so keep it short and actionable. */
export class OAuthError extends SoundCloudAuthError {}

interface PKCEChallenge {
	codeVerifier: string;
	codeChallenge: string;
	state: string;
}

export function generatePKCEChallenge(): PKCEChallenge {
	const codeVerifier = crypto.randomBytes(32).toString("base64url");
	const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
	const state = crypto.randomBytes(16).toString("hex");
	return { codeVerifier, codeChallenge, state };
}

export function getAuthorizationUrl(pkce: PKCEChallenge): string {
	const params = new URLSearchParams({
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		response_type: "code",
		code_challenge: pkce.codeChallenge,
		code_challenge_method: "S256",
		state: pkce.state,
	});
	return `${AUTH_BASE}/authorize?${params.toString()}`;
}

async function tokenRequest(
	body: URLSearchParams,
	extraHeaders: Record<string, string> = {}
): Promise<OAuthTokenResponse> {
	const response = await fetch(`${AUTH_BASE}/oauth/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json; charset=utf-8",
			...extraHeaders,
		},
		body: body.toString(),
	});
	if (!response.ok) {
		throw new OAuthError("SoundCloud token request failed. Check app credentials or reconnect.");
	}
	return response.json() as Promise<OAuthTokenResponse>;
}

async function exchangeCode(code: string, codeVerifier: string): Promise<StoredToken> {
	const token = await tokenRequest(
		new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			redirect_uri: REDIRECT_URI,
			code_verifier: codeVerifier,
			code,
		})
	);
	return saveTokens(token);
}

export async function getClientCredentialsToken(): Promise<OAuthTokenResponse> {
	const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
	return tokenRequest(new URLSearchParams({ grant_type: "client_credentials" }), {
		Authorization: `Basic ${credentials}`,
	});
}

async function requestRefresh(refresh_token: string): Promise<StoredToken> {
	const token = await tokenRequest(
		new URLSearchParams({
			grant_type: "refresh_token",
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			refresh_token,
		})
	);
	return saveTokens(token);
}

// Refresh tokens are single-use, so parallel tool calls must share one refresh.
let refreshing: Promise<StoredToken> | null = null;

function refreshToken(refresh_token: string): Promise<StoredToken> {
	refreshing ??= requestRefresh(refresh_token).finally(() => {
		refreshing = null;
	});
	return refreshing;
}

type SignOutResult = "revoked" | "forgotten" | "not-logged-in";

/**
 * Revokes the app at SoundCloud, then deletes the token file even if SoundCloud
 * refused, so signing out never leaves a token on disk.
 */
export async function signOut(sc: Pick<SoundCloudClient, "disconnect">): Promise<SignOutResult> {
	if (!hasUserToken()) return "not-logged-in";
	let result: SignOutResult = "revoked";
	try {
		await sc.disconnect();
	} catch (error) {
		debug("SoundCloud disconnect failed:", error);
		result = "forgotten";
	}
	clearTokens();
	return result;
}

export const SIGN_OUT_MESSAGES: Record<SignOutResult, string> = {
	revoked: "Signed out. SoundCloud revoked this app's access and the local token is deleted.",
	forgotten:
		"Deleted the local token, but SoundCloud did not confirm the revocation. Remove the app in your SoundCloud settings to be sure.",
	"not-logged-in": "Not logged in; nothing to sign out.",
};

// Returns a valid USER access token, refreshing if it's near expiry.
// Throws if the user hasn't logged in yet.
export async function getValidAccessToken(): Promise<string> {
	const tokens = loadTokens();
	if (!tokens) {
		throw new OAuthError("Log in with `pnpm run auth` or the connect_soundcloud tool.");
	}
	if (tokens.access_token && !isExpired(tokens)) {
		return tokens.access_token;
	}
	if (!tokens.refresh_token) {
		throw new OAuthError(
			"Token expired and cannot be refreshed. Use connect_soundcloud or run `pnpm run auth`."
		);
	}
	debug("Access token expired; refreshing");
	const refreshed = await refreshToken(tokens.refresh_token);
	return refreshed.access_token;
}

export function hasUserToken(): boolean {
	return loadTokens() !== null;
}

// Client-credentials tokens (public data) have no refresh token, so we just
// cache one in memory and re-fetch when it nears expiry.
let cachedClientToken: { access_token: string; obtained_at: number; expires_in: number } | null =
	null;

async function getCachedClientCredentialsToken(): Promise<string> {
	const now = Date.now() / 1000;
	if (
		cachedClientToken &&
		now < cachedClientToken.obtained_at + cachedClientToken.expires_in - 60
	) {
		return cachedClientToken.access_token;
	}
	const token = await getClientCredentialsToken();
	cachedClientToken = {
		access_token: token.access_token,
		obtained_at: now,
		expires_in: token.expires_in ?? 3600,
	};
	return cachedClientToken.access_token;
}

/**
 * The API client's tokens: the logged-in user's when there is one (library and
 * writes), otherwise cached client credentials for public calls.
 * `refreshAccessToken` runs after an unexpected 401 to force a new token.
 */
export const tokenProvider: TokenProvider = {
	getAccessToken: () =>
		hasUserToken() ? getValidAccessToken() : getCachedClientCredentialsToken(),
	async refreshAccessToken() {
		const tokens = loadTokens();
		if (tokens?.refresh_token) {
			const refreshed = await refreshToken(tokens.refresh_token);
			return refreshed.access_token;
		}
		cachedClientToken = null;
		return getCachedClientCredentialsToken();
	},
};

function openBrowser(url: string): void {
	const cmd =
		process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
	try {
		spawn(cmd, [url], {
			stdio: "ignore",
			detached: true,
			shell: process.platform === "win32",
		}).unref();
	} catch (error) {
		debug("Could not open browser automatically:", error);
	}
}

// Runs the full Authorization Code + PKCE flow: spins up a one-shot local
// server on the redirect URI's port, opens the browser, captures the callback
// code automatically, exchanges it for tokens, and persists them.
export function loginWithBrowser(
	options: { openBrowser?: boolean; timeoutMs?: number } = {}
): Promise<StoredToken> {
	const { openBrowser: shouldOpen = true, timeoutMs = 300_000 } = options;

	if (!CLIENT_ID || !CLIENT_SECRET) {
		return Promise.reject(
			new OAuthError("Set SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET in .env first.")
		);
	}

	const pkce = generatePKCEChallenge();
	const authUrl = getAuthorizationUrl(pkce);
	const redirect = new URL(REDIRECT_URI);
	const port = parseInt(redirect.port, 10) || (redirect.protocol === "https:" ? 443 : 80);

	return new Promise<StoredToken>((resolve, reject) => {
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			server.close();
			fn();
		};

		const server = http.createServer(async (req, res) => {
			const reqUrl = new URL(req.url || "/", `http://localhost:${port}`);
			if (reqUrl.pathname !== redirect.pathname) {
				res.writeHead(404).end();
				return;
			}

			const send = (status: number, message: string) => {
				res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
				res.end(
					`<html><body style="font-family:system-ui;text-align:center;padding-top:80px"><h1>${message}</h1><p>You can close this tab and return to your terminal.</p></body></html>`
				);
			};

			const error = reqUrl.searchParams.get("error");
			const code = reqUrl.searchParams.get("code");
			const state = reqUrl.searchParams.get("state");

			if (error) {
				send(400, "SoundCloud login failed");
				finish(() => reject(new OAuthError("SoundCloud login failed. Try connecting again.")));
			} else if (state !== pkce.state) {
				send(400, "Invalid state");
				finish(() => reject(new OAuthError("OAuth state mismatch (possible CSRF).")));
			} else if (!code) {
				send(400, "Missing authorization code");
				finish(() => reject(new OAuthError("No authorization code in callback.")));
			} else {
				try {
					const token = await exchangeCode(code, pkce.codeVerifier);
					send(200, "SoundCloud connected!");
					finish(() => resolve(token));
				} catch (err) {
					send(500, "Token exchange failed");
					finish(() => reject(err instanceof Error ? err : new OAuthError(String(err))));
				}
			}
		});

		server.on("error", (err) => finish(() => reject(err)));

		const timer = setTimeout(
			() => finish(() => reject(new OAuthError("Timed out waiting for SoundCloud callback."))),
			timeoutMs
		);

		server.listen(port, () => {
			logError(`Waiting for SoundCloud OAuth callback on ${REDIRECT_URI}`);
			logError(`Authorize URL:\n${authUrl}\n`);
			if (shouldOpen) openBrowser(authUrl);
		});
	});
}
