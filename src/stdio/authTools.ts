import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SoundCloudClient } from "../client.js";
import { getValidAccessToken, hasUserToken, loginWithBrowser, signOut } from "./oauth.js";
import { clearTokens } from "./tokenStore.js";

// Stdio handles login through tools; the worker uses transport OAuth.
export function registerAuthTools(server: McpServer, sc: SoundCloudClient): void {
	server.registerTool(
		"connect_soundcloud",
		{
			title: "Connect SoundCloud",
			description: "Log in through your browser and save the token for future sessions.",
			annotations: { title: "Connect SoundCloud", readOnlyHint: false, openWorldHint: true },
		},
		async () => {
			try {
				const { token } = await loginWithBrowser();
				const me = await sc.getMe();
				return {
					content: [
						{
							type: "text" as const,
							text: `Connected as ${me.username} (id ${me.id}). Token expires in ${token.expires_in}s and refreshes automatically.`,
						},
					],
				};
			} catch {
				return {
					content: [
						{
							type: "text" as const,
							text: "SoundCloud login failed. Try connect_soundcloud again.",
						},
					],
					isError: true,
				};
			}
		}
	);

	server.registerTool(
		"auth_status",
		{
			title: "Auth status",
			description: "Check whether a SoundCloud user is logged in.",
			annotations: { title: "Auth status", readOnlyHint: true, openWorldHint: true },
		},
		async () => {
			if (!hasUserToken()) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Not logged in. Use connect_soundcloud (public search still works).",
						},
					],
				};
			}
			const me = await sc.getMe();
			return {
				content: [{ type: "text" as const, text: `Logged in as ${me.username} (id ${me.id}).` }],
			};
		}
	);

	server.registerTool(
		"sign_out",
		{
			title: "Sign out",
			description: "Sign out and forget the stored SoundCloud token.",
			annotations: {
				title: "Sign out",
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async () => {
			const token = await getValidAccessToken();
			await signOut(token);
			clearTokens();
			return { content: [{ type: "text" as const, text: "Signed out." }] };
		}
	);
}
