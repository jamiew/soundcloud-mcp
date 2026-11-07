import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type McpEnv, mcpHandler } from "./mcp.js";

const props = {
	userId: "42",
	username: "Test User",
	permalink: "test-user",
	accessToken: "grant-token",
	refreshToken: "refresh",
	expiresAt: Date.now() + 3_600_000,
};

/** A worker request context, with the props OAuthProvider decrypted from the grant. */
function workerCtx(grantProps?: object) {
	const pending: Promise<unknown>[] = [];
	const ctx = {
		props: grantProps ?? {},
		waitUntil: (promise: Promise<unknown>) => pending.push(promise),
		passThroughOnException: () => {},
	} as unknown as ExecutionContext;
	return { ctx, pending };
}

function workerEnv(vars: { ALLOWED_USERS?: string; ENABLE_WRITE_TOOLS?: string } = {}) {
	const revoked: string[] = [];
	const env = {
		...vars,
		OAUTH_PROVIDER: {
			listUserGrants: async () => ({ items: [{ id: "grant-1" }] }),
			revokeGrant: async (id: string) => {
				revoked.push(id);
			},
		},
	} as unknown as McpEnv;
	return { env, revoked };
}

const eras = [
	{ era: "legacy", options: {} },
	{ era: "modern", options: { versionNegotiation: { mode: { pin: "2026-07-28" } } } },
] as const;

/** Connects an SDK client to the worker route in process, in the given era. */
async function connect(
	env: McpEnv,
	ctx: ExecutionContext,
	options: (typeof eras)[number]["options"]
) {
	const endpoint = new URL("https://soundcloud-mcp.example.workers.dev/mcp");
	const transport = new StreamableHTTPClientTransport(endpoint, {
		// workerd always sets Host; Node's fetch Request does not.
		fetch: (url, init) => {
			const request = new Request(url, init);
			request.headers.set("Host", endpoint.host);
			return mcpHandler.fetch(request, env, ctx);
		},
	});
	const client = new Client({ name: "test", version: "0" }, options);
	await client.connect(transport);
	return client;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe.each(eras)("worker /mcp ($era era)", ({ era, options }) => {
	it("negotiates the era", async () => {
		const client = await connect(workerEnv().env, workerCtx(props).ctx, options);
		expect(client.getProtocolEra()).toBe(era);
		await client.close();
	});

	it("calls SoundCloud with the token from the grant", async () => {
		const upstream = vi.fn(
			async (_url: string | URL | Request, _init?: RequestInit) =>
				new Response(JSON.stringify({ id: 42, username: "Test User" }), {
					headers: { "Content-Type": "application/json" },
				})
		);
		vi.stubGlobal("fetch", upstream);

		const client = await connect(workerEnv().env, workerCtx(props).ctx, options);
		const result = await client.callTool({ name: "get_profile", arguments: {} });

		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toMatchObject({ username: "Test User" });
		const headers = new Headers(upstream.mock.calls[0]?.[1]?.headers);
		expect(headers.get("Authorization")).toBe("OAuth grant-token");
		await client.close();
	});

	it("offers write tools only when the deployment enables them", async () => {
		const names = async (vars: { ENABLE_WRITE_TOOLS?: string }) => {
			const client = await connect(workerEnv(vars).env, workerCtx(props).ctx, options);
			const { tools } = await client.listTools();
			await client.close();
			return tools.map((tool) => tool.name);
		};

		const readOnly = await names({});
		expect(readOnly).toContain("sign_out");
		expect(readOnly).not.toContain("create_playlist");
		expect(await names({ ENABLE_WRITE_TOOLS: "true" })).toContain("create_playlist");
	});

	it("offers no tools without grant props", async () => {
		const client = await connect(workerEnv().env, workerCtx().ctx, options);
		expect((await client.listTools()).tools).toEqual([]);
		await client.close();
	});

	it("deletes the grants of an account removed from the allowlist", async () => {
		const { env, revoked } = workerEnv({ ALLOWED_USERS: "someone-else" });
		const { ctx, pending } = workerCtx(props);

		const client = await connect(env, ctx, options);
		expect((await client.listTools()).tools).toEqual([]);
		await Promise.all(pending);

		expect(revoked).toContain("grant-1");
		await client.close();
	});
});
