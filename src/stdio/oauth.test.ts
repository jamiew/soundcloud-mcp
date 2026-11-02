import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	generatePKCEChallenge,
	getAuthorizationUrl,
	getClientCredentialsToken,
	getValidAccessToken,
	OAuthError,
	signOut,
} from "./oauth.js";
import type * as TokenStore from "./tokenStore.js";
import type { StoredToken } from "./tokenStore.js";

// Keep tokens in memory so these tests never touch the shared token file.
const store = vi.hoisted(() => ({ token: null as StoredToken | null }));
vi.mock("./tokenStore.js", async (importOriginal) => ({
	...(await importOriginal<typeof TokenStore>()),
	loadTokens: () => store.token,
	saveTokens: (token: StoredToken) => {
		store.token = { ...token, obtained_at: Math.floor(Date.now() / 1000) };
		return store.token;
	},
	clearTokens: () => {
		store.token = null;
	},
}));

const base64url = (buf: Buffer): string =>
	buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("generatePKCEChallenge", () => {
	it("produces a codeVerifier using only base64url characters", () => {
		const pkce = generatePKCEChallenge();
		expect(pkce.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("produces a codeVerifier with no padding or unsafe characters", () => {
		const pkce = generatePKCEChallenge();
		expect(pkce.codeVerifier).not.toContain("=");
		expect(pkce.codeVerifier).not.toContain("+");
		expect(pkce.codeVerifier).not.toContain("/");
	});

	it("derives codeChallenge as the S256 hash of the verifier", () => {
		const pkce = generatePKCEChallenge();
		const expected = base64url(crypto.createHash("sha256").update(pkce.codeVerifier).digest());
		expect(pkce.codeChallenge).toBe(expected);
	});

	it("produces a state of 32 lowercase hex characters", () => {
		const pkce = generatePKCEChallenge();
		expect(pkce.state).toMatch(/^[0-9a-f]{32}$/);
	});

	it("produces unique verifiers and states across calls", () => {
		const a = generatePKCEChallenge();
		const b = generatePKCEChallenge();
		expect(a.codeVerifier).not.toBe(b.codeVerifier);
		expect(a.state).not.toBe(b.state);
	});
});

describe("getAuthorizationUrl", () => {
	const pkce = generatePKCEChallenge();
	const url = new URL(getAuthorizationUrl(pkce));

	it("points at the SoundCloud authorize endpoint", () => {
		expect(url.origin + url.pathname).toBe("https://secure.soundcloud.com/authorize");
	});

	it("includes the expected OAuth query parameters", () => {
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("code_challenge")).toBe(pkce.codeChallenge);
		expect(url.searchParams.get("state")).toBe(pkce.state);
		expect(url.searchParams.get("client_id")).toBe("test-client-id");
		expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8888/callback");
	});
});

describe("getClientCredentialsToken", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("resolves the parsed token and posts the client_credentials grant with Basic auth", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ access_token: "cc-token", expires_in: 3600, token_type: "bearer" }),
			text: async () => "",
		}));
		vi.stubGlobal("fetch", fetchMock);

		const token = await getClientCredentialsToken();
		expect(token.access_token).toBe("cc-token");

		const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(calledUrl).toContain("/oauth/token");
		expect(String(init.body)).toContain("grant_type=client_credentials");
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization.startsWith("Basic ")).toBe(true);
	});

	it("rejects token failures without exposing the response body", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: false,
			status: 401,
			json: async () => ({}),
			text: async () => "private upstream details",
		}));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getClientCredentialsToken()).rejects.toBeInstanceOf(OAuthError);
		await expect(getClientCredentialsToken()).rejects.toMatchObject({
			message: expect.not.stringContaining("private upstream details"),
		});
	});
});

describe("getValidAccessToken", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		store.token = null;
	});

	it("spends a single-use refresh token once when calls run in parallel", async () => {
		store.token = {
			access_token: "expired",
			refresh_token: "refresh-1",
			expires_in: 3600,
			scope: "*",
			token_type: "bearer",
			obtained_at: 0,
		};
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ access_token: "fresh", refresh_token: "refresh-2", expires_in: 3600 }),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const tokens = await Promise.all([getValidAccessToken(), getValidAccessToken()]);

		expect(tokens).toEqual(["fresh", "fresh"]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(store.token?.refresh_token).toBe("refresh-2");
	});
});

describe("signOut", () => {
	afterEach(() => {
		store.token = null;
	});

	it("deletes the local token even when SoundCloud rejects the revocation", async () => {
		store.token = {
			access_token: "a",
			refresh_token: "r",
			expires_in: 3600,
			scope: "*",
			token_type: "bearer",
			obtained_at: Math.floor(Date.now() / 1000),
		};
		const sc = { disconnect: vi.fn(async () => Promise.reject(new Error("400"))) };

		await expect(signOut(sc)).resolves.toBe("forgotten");
		expect(store.token).toBeNull();
	});

	it("does not call SoundCloud when nobody is logged in", async () => {
		const sc = { disconnect: vi.fn(async () => {}) };

		await expect(signOut(sc)).resolves.toBe("not-logged-in");
		expect(sc.disconnect).not.toHaveBeenCalled();
	});
});
