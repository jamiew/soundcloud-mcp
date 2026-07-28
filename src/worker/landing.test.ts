import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import type { SoundCloudClient } from "../client.js";
import { registerTools } from "../tools.js";
import { landingPage, TOOL_GROUPS } from "./landing.js";

describe("landingPage", () => {
	const html = landingPage("https://soundcloud-mcp.example.workers.dev");

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
		expect(landingPage('https://x.dev"><script>alert(1)</script>')).not.toContain("<script>");
	});

	// The list is hand-written, so without this it silently goes stale the next
	// time a tool is added or renamed.
	it("lists exactly the tools the worker registers", () => {
		const registered: string[] = [];
		const server = new McpServer({ name: "test", version: "0" });
		const spy = server.registerTool.bind(server);
		server.registerTool = ((name: string, ...rest: unknown[]) => {
			registered.push(name);
			return (spy as (...args: unknown[]) => unknown)(name, ...rest);
		}) as typeof server.registerTool;

		// Never called — registration only reads the client's shape.
		registerTools(server, {} as SoundCloudClient);

		const advertised = TOOL_GROUPS.flatMap(([, list]) => list);
		expect([...advertised].sort()).toEqual([...registered].sort());
	});
});
