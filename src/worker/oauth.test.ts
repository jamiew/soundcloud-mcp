import { describe, expect, it } from "vitest";
import { generatePkce, getAuthorizeUrl, isAccountAllowed } from "./oauth";

describe("generatePkce", () => {
	it("produces a base64url verifier and its S256 challenge", async () => {
		const { codeVerifier, codeChallenge } = await generatePkce();

		expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(codeChallenge).not.toBe(codeVerifier);
	});

	it("is fresh on every call", async () => {
		const [a, b] = await Promise.all([generatePkce(), generatePkce()]);
		expect(a.codeVerifier).not.toBe(b.codeVerifier);
	});
});

describe("getAuthorizeUrl", () => {
	it("targets secure.soundcloud.com with S256 PKCE", () => {
		const url = new URL(
			getAuthorizeUrl({
				clientId: "abc",
				redirectUri: "https://example.com/callback",
				state: "state-1",
				codeChallenge: "challenge-1",
			})
		);

		expect(url.origin).toBe("https://secure.soundcloud.com");
		expect(url.pathname).toBe("/authorize");
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
		expect(url.searchParams.get("state")).toBe("state-1");
		expect(url.searchParams.get("redirect_uri")).toBe("https://example.com/callback");
	});
});

describe("isAccountAllowed", () => {
	it("allows anyone when no allowlist is configured", () => {
		expect(isAccountAllowed(["jamiedubs"], undefined)).toBe(true);
		expect(isAccountAllowed(["jamiedubs"], "")).toBe(true);
	});

	it("matches usernames and ids case-insensitively", () => {
		expect(isAccountAllowed(["JamieDubs", "34532"], "jamiedubs")).toBe(true);
		expect(isAccountAllowed(["someone", "34532"], "jamiedubs, 34532")).toBe(true);
	});

	it("rejects accounts outside a configured allowlist", () => {
		expect(isAccountAllowed(["stranger", "999"], "jamiedubs,34532")).toBe(false);
	});
});
