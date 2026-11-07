import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Launches every server in .mcp.json exactly as an agent would, from another cwd.
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const config = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8"));
// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal placeholder from .mcp.json.
const expand = (value: string) => value.replaceAll("${CLAUDE_PROJECT_DIR:-.}", root);
const servers = Object.entries<{ command: string; args: string[] }>(config.mcpServers);

const eras = [
	{ era: "legacy", options: {} },
	{ era: "modern", options: { versionNegotiation: { mode: { pin: "2026-07-28" } } } },
] as const;

let tmp: string;
beforeAll(() => {
	execFileSync("pnpm", ["build"], { cwd: root, stdio: "ignore" });
	tmp = mkdtempSync(path.join(os.tmpdir(), "soundcloud-mcp-"));
}, 60_000);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe.each(servers)(".mcp.json %s", (_, server) => {
	describe.each(eras)("$era era", ({ era, options }) => {
		it("serves tools, prompts and resources over stdio", async () => {
			const transport = new StdioClientTransport({
				command: expand(server.command),
				args: server.args.map(expand),
				cwd: tmp,
				// Explicit values win over anything the config loads from .env.
				env: {
					PATH: process.env.PATH ?? "",
					HOME: tmp,
					SOUNDCLOUD_CLIENT_ID: "test-client-id",
					SOUNDCLOUD_CLIENT_SECRET: "test-client-secret",
					SOUNDCLOUD_TOKEN_FILE: path.join(tmp, "tokens.json"),
				},
				stderr: "ignore",
			});
			const client = new Client({ name: "test", version: "0" }, options);
			await client.connect(transport);
			try {
				expect(client.getProtocolEra()).toBe(era);
				expect(client.getServerVersion()?.version).toBe(pkg.version);

				const { tools } = await client.listTools();
				expect(tools.length).toBeGreaterThan(0);
				for (const tool of tools) {
					const hints = tool.annotations ?? {};
					expect(hints.readOnlyHint, tool.name).toBeTypeOf("boolean");
					if (!hints.readOnlyHint) expect(hints.destructiveHint, tool.name).toBeTypeOf("boolean");
				}
				expect((await client.listPrompts()).prompts.length).toBeGreaterThan(0);
				expect((await client.listResources()).resources.length).toBeGreaterThan(0);

				const status = await client.callTool({ name: "auth_status", arguments: {} });
				expect(status.isError).toBeFalsy();
				expect(status.content).toEqual([
					{
						type: "text",
						text: "Not logged in. Use connect_soundcloud (public search still works).",
					},
				]);
			} finally {
				await client.close();
			}
		}, 30_000);
	});
});
