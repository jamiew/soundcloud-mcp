import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import type { SoundCloudClient } from "../client.js";
import { registerTools } from "../tools.js";
import { landingPage } from "./landing.js";
import { registerSignOut } from "./signOut.js";

/** Tool names the hosted server registers for this setting. */
function registeredTools(writes: boolean): string[] {
	const registered: string[] = [];
	const server = new McpServer({ name: "test", version: "0" });
	const spy = server.registerTool.bind(server);
	server.registerTool = ((name: string, ...rest: unknown[]) => {
		registered.push(name);
		return (spy as (...args: unknown[]) => unknown)(name, ...rest);
	}) as typeof server.registerTool;

	// Never called — registration only reads the client's shape.
	const client = {} as SoundCloudClient;
	registerTools(server, client, { writes });
	registerSignOut(server, client, {} as Parameters<typeof registerSignOut>[2], "1");
	return registered.sort();
}

describe("landingPage", () => {
	const html = landingPage("https://soundcloud-mcp.example.workers.dev", true);

	it("shows the MCP endpoint for the origin it was called with", () => {
		expect(html).toContain("https://soundcloud-mcp.example.workers.dev/mcp");
	});

	it("gives a copy-pasteable Claude Code install line", () => {
		expect(html).toContain(
			"claude mcp add --transport http soundcloud https://soundcloud-mcp.example.workers.dev/mcp"
		);
	});

	it("links back to the source repo", () => {
		expect(html).toContain("https://github.com/jamiew/soundcloud-mcp");
	});

	it("is self-contained — no external assets to trip a CSP", () => {
		expect(html).not.toMatch(/<script/i);
		expect(html).not.toMatch(/<link[^>]+stylesheet/i);
	});

	it("escapes the origin rather than interpolating it raw", () => {
		expect(landingPage('https://x.dev"><script>alert(1)</script>', true)).not.toContain("<script>");
	});

	it("links the privacy page", () => {
		expect(html).toContain('href="/privacy"');
	});

	// The list is hand-written, so without this it silently goes stale the next
	// time a tool is added or renamed, or advertises tools a deployment turned off.
	it.each([true, false])("lists exactly the tools the worker registers (writes: %s)", (writes) => {
		const page = landingPage("https://x.dev", writes);
		const listed = [...page.matchAll(/<li><code>(\w+)<\/code><\/li>/g)].map((m) => m[1]);
		expect(listed.sort()).toEqual(registeredTools(writes));
	});
});
