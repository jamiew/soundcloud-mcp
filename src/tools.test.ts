import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import type { SoundCloudClient } from "./client.js";
import { serverInfo } from "./server.js";
import { registerAuthTools } from "./stdio/authTools.js";
import { registerTools } from "./tools.js";

/** Lists tools as a client sees them. Registration never calls the client. */
async function listTools({ writes, auth }: { writes: boolean; auth: boolean }) {
	const server = new McpServer({ name: "test", version: "0" });
	const sc = {} as SoundCloudClient;
	registerTools(server, sc, { writes });
	if (auth) registerAuthTools(server, sc);

	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: "test", version: "0" });
	await client.connect(clientTransport);
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

describe("serverInfo", () => {
	it("reports the package version", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		expect(serverInfo("test").version).toBe(pkg.version);
	});
});
