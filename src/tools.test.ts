import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { SoundCloudClient } from "./client.js";
import { registerAuthTools } from "./stdio/authTools.js";
import { registerTools } from "./tools.js";

type Upstream = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Connects an SDK client in process. `upstream` answers every SoundCloud request. */
async function connect({
	writes = true,
	auth = false,
	upstream = () => new Response("{}"),
}: {
	writes?: boolean;
	auth?: boolean;
	upstream?: Upstream;
} = {}) {
	const token = async () => "token";
	const sc = new SoundCloudClient(
		{ getAccessToken: token, refreshAccessToken: token },
		undefined,
		async (url, init) => upstream(String(url), init ?? {})
	);
	const server = new McpServer({ name: "test", version: "0" });
	registerTools(server, sc, { writes });
	if (auth) registerAuthTools(server, sc);

	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: "test", version: "0" });
	await client.connect(clientTransport);
	return client;
}

async function listTools(options: { writes: boolean; auth: boolean }) {
	const client = await connect(options);
	const { tools } = await client.listTools();
	await client.close();
	return tools;
}

describe("tool metadata", async () => {
	const tools = await listTools({ writes: true, auth: true });

	it.each(tools.map((tool) => [tool.name, tool]))("%s has a title and description", (_, tool) => {
		expect(tool.title).toBeTruthy();
		expect(tool.description).toBeTruthy();
	});

	// Clients use these hints to decide what needs confirmation. A missing
	// destructiveHint defaults to true, so an unmarked like looks like a delete.
	it.each(tools.map((tool) => [tool.name, tool]))("%s declares its behavior", (_, tool) => {
		const hints = tool.annotations ?? {};
		expect(hints.readOnlyHint).toBeTypeOf("boolean");
		expect(hints.openWorldHint).toBe(true);
		if (!hints.readOnlyHint) expect(hints.destructiveHint).toBeTypeOf("boolean");
	});

	it("registers only read-only tools when writes are off", async () => {
		const readOnly = await listTools({ writes: false, auth: false });
		const writable = readOnly.filter((tool) => !tool.annotations?.readOnlyHint);
		expect(writable.map((tool) => tool.name)).toEqual([]);
	});
});

describe("cancellation", () => {
	it("aborts the SoundCloud request when the client cancels the tool call", async () => {
		const upstreamSignal = Promise.withResolvers<AbortSignal>();
		const client = await connect({
			upstream: (_url, init) => {
				if (init.signal) upstreamSignal.resolve(init.signal);
				return Promise.withResolvers<Response>().promise;
			},
		});
		const cancel = new AbortController();
		const call = client.callTool({ name: "get_profile", arguments: {} }, { signal: cancel.signal });
		const signal = await upstreamSignal.promise;

		cancel.abort();
		await expect(call).rejects.toThrow();
		await expect.poll(() => signal.aborted).toBe(true);
		await client.close();
	});
});

// Resources and prompts fail with protocol errors, not tool results, but they
// must still keep upstream details out of what the client sees.
describe("resource and prompt errors", () => {
	it("reports a missing track resource as not found", async () => {
		let requests = 0;
		const client = await connect({
			upstream: () => {
				requests += 1;
				return new Response("{}", { status: 404 });
			},
		});
		await expect(client.readResource({ uri: "soundcloud://tracks/1" })).rejects.toMatchObject({
			data: { uri: "soundcloud://tracks/1" },
		});
		expect(requests).toBe(1);
		await client.close();
	});

	it("keeps an unreadable upstream body out of prompt errors", async () => {
		const client = await connect({ upstream: () => new Response("<html>upstream page") });
		const error = await client.getPrompt({ name: "analyze_music_taste" }).catch((e) => e);
		expect(error).toBeInstanceOf(Error);
		expect(error.message).not.toContain("upstream page");
		await client.close();
	});
});
