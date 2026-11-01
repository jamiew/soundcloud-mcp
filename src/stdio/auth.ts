#!/usr/bin/env node
// CLI login: opens a browser, captures the SoundCloud OAuth callback, and
// stores tokens so the MCP server can use them across sessions. `--sign-out`
// revokes the app's access and deletes the stored token instead.
import { SoundCloudClient } from "../client.js";
import { CLIENT_ID, CLIENT_SECRET, TOKEN_FILE } from "./config.js";
import {
	loginWithBrowser,
	OAuthError,
	SIGN_OUT_MESSAGES,
	signOut,
	tokenProvider,
} from "./oauth.js";

async function main() {
	if (!CLIENT_ID || !CLIENT_SECRET) {
		console.error("Missing SOUNDCLOUD_CLIENT_ID or SOUNDCLOUD_CLIENT_SECRET in .env");
		process.exit(1);
	}

	const client = new SoundCloudClient(tokenProvider);
	if (process.argv.includes("--sign-out")) {
		console.error(SIGN_OUT_MESSAGES[await signOut(client)]);
		return;
	}

	const noBrowser = process.argv.includes("--no-browser");
	const { token } = await loginWithBrowser({ openBrowser: !noBrowser });

	const me = await client.getMe();

	console.error(`\nConnected as ${me.username} (id ${me.id}).`);
	console.error(`Tokens saved to: ${TOKEN_FILE}`);
	console.error(`Access token expires in ${token.expires_in}s and will auto-refresh.`);
}

main().catch((error) => {
	const message =
		error instanceof OAuthError || error instanceof Error ? error.message : String(error);
	console.error(`\nLogin failed: ${message}`);
	process.exit(1);
});
