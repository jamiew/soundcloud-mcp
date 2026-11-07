#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
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

// Use a user token when logged in, otherwise cached client credentials.
const sc = new SoundCloudClient(tokenProvider);

// serveStdio picks the protocol era from the client's first message.
serveStdio(
	() => {
		const server = new McpServer(serverInfo("soundcloud"), {
			instructions: instructions(
				"- Public search needs no login. Use `connect_soundcloud` for personal data and writes."
			),
		});
		registerTools(server, sc);
		registerAuthTools(server, sc);
		return server;
	},
	{ onerror: (error) => logError("MCP error:", error) }
);
logError("SoundCloud MCP server running on stdio");
