import { describe, expect, it } from "vitest";
import { landingPage } from "./landing";

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
});
