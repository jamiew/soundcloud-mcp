import type { McpServer } from "@modelcontextprotocol/server";
import type { SoundCloudClient } from "../client.js";
import { run } from "../tools.js";
import { hasUserToken, loginWithBrowser, SIGN_OUT_MESSAGES, signOut } from "./oauth.js";

// Stdio handles login through tools; the worker uses transport OAuth.
export function registerAuthTools(server: McpServer, sc: SoundCloudClient): void {
	server.registerTool(
		"connect_soundcloud",
		{
			title: "Connect SoundCloud",
			description: "Log in through your browser and save the token for future sessions.",
			annotations: {
				title: "Connect SoundCloud",
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: true,
			},
		},
		async () =>
			run(async () => {
				const token = await loginWithBrowser();
				const me = await sc.getMe();
				return `Connected as ${me.username} (id ${me.id}). Token expires in ${token.expires_in}s and refreshes automatically.`;
			})
	);

	server.registerTool(
		"auth_status",
		{
			title: "Auth status",
			description: "Check whether a SoundCloud user is logged in.",
			annotations: { title: "Auth status", readOnlyHint: true, openWorldHint: true },
		},
		async () =>
			run(async () => {
				if (!hasUserToken()) {
					return "Not logged in. Use connect_soundcloud (public search still works).";
				}
				const me = await sc.getMe();
				return `Logged in as ${me.username} (id ${me.id}).`;
			})
	);

	server.registerTool(
		"sign_out",
		{
			title: "Sign out",
			description:
				"Revoke this app's SoundCloud access and delete the stored token. Public search still works afterward.",
			annotations: {
				title: "Sign out",
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async () => run(async () => SIGN_OUT_MESSAGES[await signOut(sc)])
	);
}
