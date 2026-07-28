// Upstream (SoundCloud) side of the OAuth flow. SoundCloud is OAuth 2.1:
// PKCE is mandatory, and refresh tokens are single-use — every refresh returns
// a new one that must replace the old.

import type { OAuthTokenResponse } from "./types";

// Token + authorize endpoints live on secure.soundcloud.com. SoundCloud's own
// agent guidance explicitly warns off the legacy api.soundcloud.com/oauth2/token.
export const AUTH_BASE = "https://secure.soundcloud.com";

/**
 * Context captured at authorization time, encrypted into the issued MCP token
 * and handed to the McpAgent as `this.props`.
 */
export type Props = {
	userId: string;
	username: string;
	accessToken: string;
	refreshToken: string;
	/** Epoch milliseconds. */
	expiresAt: number;
};

export interface Tokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}

export interface Pkce {
	codeVerifier: string;
	codeChallenge: string;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let binary = "";
	for (const byte of view) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function generatePkce(): Promise<Pkce> {
	const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
	return { codeVerifier, codeChallenge: base64url(digest) };
}

export function getAuthorizeUrl(opts: {
	clientId: string;
	redirectUri: string;
	state: string;
	codeChallenge: string;
}): string {
	const url = new URL(`${AUTH_BASE}/authorize`);
	url.searchParams.set("client_id", opts.clientId);
	url.searchParams.set("redirect_uri", opts.redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("code_challenge", opts.codeChallenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", opts.state);
	return url.href;
}

async function tokenRequest(body: Record<string, string>): Promise<OAuthTokenResponse> {
	const response = await fetch(`${AUTH_BASE}/oauth/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json; charset=utf-8",
		},
		body: new URLSearchParams(body).toString(),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`SoundCloud token request failed (${response.status}): ${text.slice(0, 300)}`);
	}
	return (await response.json()) as OAuthTokenResponse;
}

function normalize(token: OAuthTokenResponse, previousRefresh?: string): Tokens {
	const refreshToken = token.refresh_token ?? previousRefresh;
	if (!refreshToken) throw new Error("SoundCloud did not return a refresh token");
	return {
		accessToken: token.access_token,
		refreshToken,
		expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
	};
}

export async function exchangeCode(opts: {
	clientId: string;
	clientSecret: string;
	code: string;
	redirectUri: string;
	codeVerifier: string;
}): Promise<Tokens> {
	return normalize(
		await tokenRequest({
			grant_type: "authorization_code",
			client_id: opts.clientId,
			client_secret: opts.clientSecret,
			redirect_uri: opts.redirectUri,
			code_verifier: opts.codeVerifier,
			code: opts.code,
		})
	);
}

export async function refreshTokens(opts: {
	clientId: string;
	clientSecret: string;
	refreshToken: string;
}): Promise<Tokens> {
	return normalize(
		await tokenRequest({
			grant_type: "refresh_token",
			client_id: opts.clientId,
			client_secret: opts.clientSecret,
			refresh_token: opts.refreshToken,
		}),
		// Defensive: the spec says refresh tokens rotate, but keep the old one
		// usable if a response ever omits the replacement.
		opts.refreshToken
	);
}

/**
 * Access control by SoundCloud account. `allowedRaw` is the ALLOWED_USERS
 * secret: a comma-separated list of usernames and/or numeric user ids. Empty
 * or unset means any SoundCloud account may connect.
 */
export function isAccountAllowed(
	identifiers: (string | undefined | null)[],
	allowedRaw: string | undefined | null
): boolean {
	const allow = (allowedRaw ?? "")
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
	if (allow.length === 0) return true;
	return identifiers.some((id) => !!id && allow.includes(id.toLowerCase()));
}
