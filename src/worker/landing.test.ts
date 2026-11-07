import { describe, expect, it } from "vitest";
import { landingPage } from "./landing.js";

// mcp.test.ts checks the listed tools against the ones the worker serves, and
// worker.workerd.test.ts checks the served page's install line and links.
describe("landingPage", () => {
	const html = landingPage("https://soundcloud-mcp.example.workers.dev", true, true);

	it("loads no external assets that a CSP could block", () => {
		expect(html).not.toMatch(/<script/i);
		expect(html).not.toMatch(/<link[^>]+stylesheet/i);
	});

	it("escapes the origin rather than interpolating it raw", () => {
		expect(landingPage('https://x.dev"><script>alert(1)</script>', true, true)).not.toContain(
			"<script>"
		);
	});

	it("mentions the allowlist only when one is set", () => {
		expect(html).toContain("approved SoundCloud account");
		expect(landingPage("https://x.dev", true, false)).not.toContain("approved SoundCloud account");
	});
});
