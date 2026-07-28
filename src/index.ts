#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SoundCloudAPI } from "./api.js";
import { CLIENT_ID, CLIENT_SECRET } from "./config.js";
import { logError } from "./log.js";
import { getApiToken } from "./oauth.js";
import { registerAll } from "./tools.js";

if (!CLIENT_ID || !CLIENT_SECRET) {
  logError(
    "Missing SOUNDCLOUD_CLIENT_ID or SOUNDCLOUD_CLIENT_SECRET. Copy .env.example to .env and fill them in."
  );
  process.exit(1);
}

// Inline so the icon works offline and for anyone self-hosting — a hosted URL
// would tie this npm package to one person's worker.
const ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f50"/><g fill="#fff"><rect x="12" y="25" width="5" height="14" rx="2.5"/><rect x="21" y="19" width="5" height="26" rx="2.5"/><rect x="30" y="14" width="5" height="36" rx="2.5"/><rect x="39" y="21" width="5" height="22" rx="2.5"/><rect x="48" y="26" width="5" height="12" rx="2.5"/></g></svg>'
  );

const server = new McpServer(
  {
    name: "soundcloud",
    title: "SoundCloud",
    version: "1.0.0",
    description: "Search SoundCloud, read your library, and manage playlists, follows, likes and reposts.",
    websiteUrl: "https://github.com/jamiew/soundcloud-mcp",
    icons: [{ src: ICON, mimeType: "image/svg+xml", sizes: ["any"] }],
  },
  {
    instructions: [
      "SoundCloud, through the official API.",
      "",
      "- When the user pastes a soundcloud.com link, start with `resolve_url` — it returns the underlying track, user, or playlist.",
      "- Ids may be numeric or URNs (`soundcloud:tracks:123`). Both work; URNs are what SoundCloud prefers.",
      "- List results carry `next_href`. Pass it to `next_page` to page (default 50 per page, max 200).",
      "- Public search works without a login. Personal data and any write need `connect_soundcloud` first.",
      "- There is no personalized recommendation endpoint. Seed `get_related_tracks` from something the user already likes, or read `get_feed`.",
    ].join("\n"),
  }
);

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
