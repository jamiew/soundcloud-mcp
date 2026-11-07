import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";
import { describe, expect, it } from "vitest";
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

const SECRET = "cookie-secret";
const ORIGIN = "https://soundcloud-mcp.example.workers.dev";

/** An in-memory KV with the three calls the helpers make. */
function memoryKv() {
	const store = new Map<string, string>();
	const kv = {
		get: async (key: string) => store.get(key) ?? null,
		put: async (key: string, value: string) => {
			store.set(key, value);
		},
		delete: async (key: string) => {
			store.delete(key);
		},
	} as unknown as KVNamespace;
	return { kv, store };
}

/** Turns a Set-Cookie value into the Cookie header a browser would send back. */
const sent = (...setCookies: string[]) => setCookies.map((value) => value.split(";")[0]).join("; ");

const request = (path: string, cookie?: string) =>
	new Request(`${ORIGIN}${path}`, cookie ? { headers: { Cookie: cookie } } : {});

const authRequest: AuthRequest = {
	responseType: "code",
	clientId: "client-1",
	redirectUri: "https://client.example/cb",
	scope: [],
	state: "client-state",
};

const form = (fields: Record<string, string>) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
};

describe("CSRF protection", () => {
	it("sets a host-only, HttpOnly, Secure cookie", () => {
		const { setCookie } = generateCSRFProtection();
		expect(setCookie).toMatch(/^__Host-CSRF_TOKEN=[^;]+; HttpOnly; Secure; Path=\/; SameSite=Lax/);
	});

	it("accepts a form token that matches its cookie", () => {
		const { token, setCookie } = generateCSRFProtection();
		const result = validateCSRFToken(form({ csrf_token: token }), request("/", sent(setCookie)));
		expect(result.clearCookie).toContain("Max-Age=0");
	});

	it.each([
		["no form token", {}, true],
		["no cookie", { csrf_token: "token" }, false],
		["a different token", { csrf_token: "other" }, true],
	])("rejects %s", (_, fields, withCookie) => {
		const cookie = withCookie ? "__Host-CSRF_TOKEN=token" : undefined;
		expect(() => validateCSRFToken(form(fields), request("/", cookie))).toThrow(OAuthError);
	});
});

describe("OAuth state binding", () => {
	async function start() {
		const { kv, store } = memoryKv();
		const { stateToken } = await createOAuthState(authRequest, kv);
		const { setCookie } = await bindStateToSession(stateToken);
		return { kv, store, stateToken, cookie: sent(setCookie) };
	}

	it("returns the stored request once, for the browser that started the flow", async () => {
		const { kv, store, stateToken, cookie } = await start();
		const callback = request(`/callback?state=${stateToken}`, cookie);

		const result = await validateOAuthState(callback, kv);

		expect(result.oauthReqInfo).toEqual(authRequest);
		expect(store.size).toBe(0);
		await expect(validateOAuthState(callback, kv)).rejects.toThrow("Invalid or expired state");
	});

	it("stores only a hash of the state in the cookie", async () => {
		const { stateToken, cookie } = await start();
		expect(cookie).not.toContain(stateToken);
	});

	it("rejects a callback from a browser without the binding cookie", async () => {
		const { kv, stateToken } = await start();
		await expect(validateOAuthState(request(`/callback?state=${stateToken}`), kv)).rejects.toThrow(
			"Missing session binding cookie"
		);
	});

	it("rejects a state bound to a different session", async () => {
		const first = await start();
		const { kv, stateToken } = await start();
		await expect(
			validateOAuthState(request(`/callback?state=${stateToken}`, first.cookie), kv)
		).rejects.toThrow("does not match session");
	});

	it("rejects a missing or unknown state", async () => {
		const { kv, cookie } = await start();
		await expect(validateOAuthState(request("/callback", cookie), kv)).rejects.toThrow(
			"Missing state"
		);
		await expect(validateOAuthState(request("/callback?state=nope", cookie), kv)).rejects.toThrow(
			"Invalid or expired state"
		);
	});
});

describe("approved clients cookie", () => {
	it("remembers approved clients across visits", async () => {
		const first = await addApprovedClient(request("/"), "client-1", SECRET);
		const second = await addApprovedClient(request("/", sent(first)), "client-2", SECRET);
		const browser = request("/authorize", sent(second));

		expect(await isClientApproved(browser, "client-1", SECRET)).toBe(true);
		expect(await isClientApproved(browser, "client-2", SECRET)).toBe(true);
		expect(await isClientApproved(browser, "client-3", SECRET)).toBe(false);
		expect(second).toMatch(/HttpOnly; Secure; Path=\/; SameSite=Lax; Max-Age=2592000$/);
	});

	it("ignores a cookie signed with another secret", async () => {
		const setCookie = await addApprovedClient(request("/"), "client-1", "other-secret");
		expect(await isClientApproved(request("/", sent(setCookie)), "client-1", SECRET)).toBe(false);
	});

	it("ignores a cookie whose client list was edited", async () => {
		const setCookie = await addApprovedClient(request("/"), "client-1", SECRET);
		const [signature] = sent(setCookie).split("=")[1]?.split(".") ?? [];
		const forged = `__Host-APPROVED_CLIENTS=${signature}.${btoa(JSON.stringify(["evil"]))}`;
		expect(await isClientApproved(request("/", forged), "evil", SECRET)).toBe(false);
	});

	it("ignores malformed cookies", async () => {
		for (const value of ["", "abc", "zz.e30=", "00.!!!", "00.e30=.extra"]) {
			const browser = request("/", `__Host-APPROVED_CLIENTS=${value}`);
			expect(await isClientApproved(browser, "client-1", SECRET)).toBe(false);
		}
	});
});

describe("approval dialog", () => {
	const hostile = '<script>alert("x")</script>';

	function render(client: Partial<ClientInfo>) {
		return renderApprovalDialog(request("/authorize"), {
			client: {
				clientId: "client-1",
				redirectUris: [],
				tokenEndpointAuthMethod: "none",
				...client,
			},
			server: { name: "SoundCloud MCP Server", logo: `${ORIGIN}/icon.svg` },
			state: { oauthReqInfo: authRequest },
			csrfToken: "csrf-1",
			setCookie: "__Host-CSRF_TOKEN=csrf-1",
		});
	}

	it("escapes client-supplied text and drops non-http links", async () => {
		const html = await render({
			clientName: hostile,
			clientUri: "javascript:alert(1)",
			redirectUris: ["https://client.example/cb", "javascript:alert(2)"],
		}).text();

		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
		expect(html).not.toContain("javascript:");
		expect(html).toContain("https://client.example/cb");
	});

	it("posts the CSRF token and state, and cannot be framed", async () => {
		const response = render({ clientName: "Claude" });
		const html = await response.text();

		expect(html).toContain('name="csrf_token" value="csrf-1"');
		expect(html).toContain(`value="${btoa(JSON.stringify({ oauthReqInfo: authRequest }))}"`);
		expect(response.headers.get("Set-Cookie")).toBe("__Host-CSRF_TOKEN=csrf-1");
		expect(response.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
		expect(response.headers.get("X-Frame-Options")).toBe("DENY");
	});
});
