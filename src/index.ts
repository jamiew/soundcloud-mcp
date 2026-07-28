#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SoundCloudClient } from "./client.js";
import { instructions, serverInfo } from "./server.js";
import { registerAuthTools } from "./stdio/authTools.js";
import { CLIENT_ID, CLIENT_SECRET } from "./stdio/config.js";
import { logError } from "./stdio/log.js";
import { tokenProvider } from "./stdio/oauth.js";
import { registerTools } from "./tools.js";

if (!CLIENT_ID || !CLIENT_SECRET) {
	logError(
		"Missing SOUNDCLOUD_CLIENT_ID or SOUNDCLOUD_CLIENT_SECRET. Copy .env.example to .env and fill them in."
	);
	process.exit(1);
}

const server = new McpServer(serverInfo("soundcloud", "1.0.0"), {
	instructions: instructions(
		"- Public search works without a login. Personal data and any write need `connect_soundcloud` first."
	),
});

// One client over the unified token provider: a logged-in user token when there
// is one, client-credentials otherwise so public search still works.
const sc = new SoundCloudClient(tokenProvider);
registerTools(server, sc);
registerAuthTools(server, sc);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	logError("SoundCloud MCP server running on stdio");
}

main().catch((error) => {
	logError("Fatal error:", error);
	process.exit(1);
});
