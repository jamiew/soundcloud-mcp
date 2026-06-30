#!/usr/bin/env node
// One-time CLI login: opens a browser, captures the SoundCloud OAuth callback,
// and stores tokens so the MCP server can use them across sessions.
import { loginWithBrowser, OAuthError } from "./oauth.js";
import { SoundCloudAPI } from "./api.js";
import { getValidAccessToken } from "./oauth.js";
import { TOKEN_FILE, CLIENT_ID, CLIENT_SECRET } from "./config.js";

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("Missing SOUNDCLOUD_CLIENT_ID or SOUNDCLOUD_CLIENT_SECRET in .env");
    process.exit(1);
  }

  const noBrowser = process.argv.includes("--no-browser");
  const { token } = await loginWithBrowser({ openBrowser: !noBrowser });

  const api = new SoundCloudAPI(getValidAccessToken);
  const me = await api.getCurrentUser();

  console.error(`\nConnected as ${me.username} (id ${me.id}).`);
  console.error(`Tokens saved to: ${TOKEN_FILE}`);
  console.error(`Access token expires in ${token.expires_in}s and will auto-refresh.`);
}

main().catch((error) => {
  const message = error instanceof OAuthError || error instanceof Error ? error.message : String(error);
  console.error(`\nLogin failed: ${message}`);
  process.exit(1);
});
