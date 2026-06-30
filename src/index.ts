#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SoundCloudAPI } from "./api.js";
import { getApiToken } from "./oauth.js";
import { registerAll } from "./tools.js";
import { CLIENT_ID, CLIENT_SECRET } from "./config.js";
import { logError } from "./log.js";

if (!CLIENT_ID || !CLIENT_SECRET) {
  logError("Missing SOUNDCLOUD_CLIENT_ID or SOUNDCLOUD_CLIENT_SECRET. Copy .env.example to .env and fill them in.");
  process.exit(1);
}

const server = new McpServer({ name: "soundcloud", version: "1.0.0" });

// One API client backed by the unified token provider — it returns a logged-in
// user token when available and falls back to client-credentials for public calls.
const api = new SoundCloudAPI(getApiToken);
registerAll(server, api);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logError("SoundCloud MCP server running on stdio");
}

main().catch((error) => {
  logError("Fatal error:", error);
  process.exit(1);
});
