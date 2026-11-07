import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { McpServer } from "@modelcontextprotocol/server";
import type { SoundCloudClient } from "../client.js";
import { run } from "../tools.js";

type Grants = Pick<OAuthHelpers, "listUserGrants" | "revokeGrant">;

/** Deletes every stored grant for the user, along with its tokens and SoundCloud props. */
export async function deleteUserGrants(grants: Grants, userId: string): Promise<number> {
	const ids: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await grants.listUserGrants(userId, cursor ? { cursor } : {});
		ids.push(...page.items.map((grant) => grant.id));
		cursor = page.cursor;
	} while (cursor);
	// List everything first: deleting while paging can shift the cursor.
	for (const id of ids) await grants.revokeGrant(id, userId);
	return ids.length;
}

/**
 * Revokes the app at SoundCloud, then deletes the user's stored grants even if
 * SoundCloud refused, so a sign-out never leaves tokens behind.
 */
export async function signOut(
	sc: Pick<SoundCloudClient, "disconnect">,
	grants: Grants,
	userId: string
): Promise<string> {
	let revoked = true;
	try {
		await sc.disconnect();
	} catch (error) {
		console.error("SoundCloud disconnect failed:", error);
		revoked = false;
	}
	await deleteUserGrants(grants, userId);
	return revoked
		? "Signed out. SoundCloud revoked this server's access and the server deleted your stored tokens. Reconnect to use it again."
		: "Deleted your stored tokens, but SoundCloud did not confirm the revocation. Remove the app in your SoundCloud settings to be sure.";
}

/** Hosted-only: the local server has its own sign_out that clears the token file. */
export function registerSignOut(
	server: McpServer,
	sc: SoundCloudClient,
	grants: Grants,
	userId: string
): void {
	server.registerTool(
		"sign_out",
		{
			title: "Sign out",
			description:
				"Revoke this server's SoundCloud access and delete your stored tokens on every connected client. You must reconnect afterward.",
			annotations: {
				title: "Sign out",
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async () => run(() => signOut(sc, grants, userId))
	);
}
