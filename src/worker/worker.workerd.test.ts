// The real Worker (OAuthProvider, Hono routes and the /mcp handler) in workerd.
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const ORIGIN = "https://soundcloud-mcp.example.workers.dev";

const initialize = {
	method: "POST",
	headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
	body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
};

describe("worker", () => {
	it("serves the install page for its own origin", async () => {
		const response = await SELF.fetch(`${ORIGIN}/`);
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/html");
		expect(html).toContain(`claude mcp add --transport http soundcloud ${ORIGIN}/mcp`);
		expect(html).toContain('href="/privacy"');
	});

	it.each([
		["without a token", {}],
		["with an unknown token", { Authorization: "Bearer not-a-real-token" }],
	])("refuses /mcp %s and points at the OAuth metadata", async (_, auth) => {
		const response = await SELF.fetch(`${ORIGIN}/mcp`, {
			...initialize,
			headers: { ...initialize.headers, ...auth },
		});

		expect(response.status).toBe(401);
		expect(response.headers.get("WWW-Authenticate")).toContain(
			`${ORIGIN}/.well-known/oauth-protected-resource`
		);
	});

	it("binds tokens to the /mcp resource", async () => {
		const response = await SELF.fetch(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`);
		const metadata = z.looseObject({ resource: z.string() }).parse(await response.json());
		expect(metadata.resource).toBe(`${ORIGIN}/mcp`);
	});

	it("asks a registered client for approval with a CSRF cookie", async () => {
		const registered = await SELF.fetch(`${ORIGIN}/register`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				redirect_uris: ["http://localhost:8976/callback"],
				client_name: "Test <Client>",
				token_endpoint_auth_method: "none",
			}),
		});
		const { client_id } = z.object({ client_id: z.string() }).parse(await registered.json());
		const url = new URL(`${ORIGIN}/authorize`);
		url.search = new URLSearchParams({
			client_id,
			redirect_uri: "http://localhost:8976/callback",
			response_type: "code",
			code_challenge: "x".repeat(43),
			code_challenge_method: "S256",
			state: "client-state",
		}).toString();

		const response = await SELF.fetch(url, { redirect: "manual" });
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("Set-Cookie")).toMatch(/^__Host-CSRF_TOKEN=/);
		expect(html).toContain("Test &lt;Client&gt; is requesting access");
		expect(html).toContain('name="csrf_token"');
	});
});
