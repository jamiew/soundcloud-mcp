import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { SoundCloudAuthError, SoundCloudClient } from "../client.js";
import { HOSTED_ICON } from "../icon.js";
import { instructions, serverInfo } from "../server.js";
import { registerTools } from "../tools.js";
import { isAccountAllowed, type Props, PropsSchema, writesEnabled } from "./oauth.js";
import { deleteUserGrants, registerSignOut } from "./signOut.js";

// OAuthProvider adds its helpers to env before calling API handlers.
export type McpEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

// Every request builds a fresh server from the props OAuthProvider decrypts
// out of the grant, so rotated tokens apply on the next request and no
// Durable Object or session state lives between requests.
function createServer(
	workerEnv: McpEnv,
	ctx: ExecutionContext,
	props: Props | undefined
): McpServer {
	const server = new McpServer(serverInfo("soundcloud-mcp", [HOSTED_ICON]), {
		instructions: instructions(
			"- The connected account is already authorized; there is no login step."
		),
	});

	if (!props) return server;
	// Recheck the callback's allowlist. An account removed from it has lost
	// access, so delete its stored grants instead of keeping dead tokens.
	if (!isAccountAllowed([props.permalink, props.userId], workerEnv.ALLOWED_USERS)) {
		ctx.waitUntil(deleteUserGrants(workerEnv.OAUTH_PROVIDER, props.userId));
		return server;
	}

	const client = new SoundCloudClient({
		getAccessToken: async () => {
			const token = props.accessToken;
			if (!token) throw new SoundCloudAuthError();
			return token;
		},
		// Only tokenExchangeCallback may spend the single-use refresh token.
		refreshAccessToken: async () => {
			throw new SoundCloudAuthError();
		},
	});

	registerTools(server, client, { writes: writesEnabled(workerEnv) });
	registerSignOut(server, client, workerEnv.OAUTH_PROVIDER, props.userId);
	return server;
}

/** Serves both protocol eras per request: 2026-07-28 and stateless 2025 traffic. */
export const mcpHandler = {
	fetch(request: Request, workerEnv: McpEnv, ctx: ExecutionContext) {
		const props = PropsSchema.safeParse(ctx.props).data;
		return createMcpHandler(() => createServer(workerEnv, ctx, props), {
			route: "/mcp",
			// OAuthProvider rejects requests without a bearer token before this
			// runs, and browsers never attach that token on their own, so an
			// Origin check protects nothing here. It would only block browser
			// clients that worked before.
			allowedOriginHostnames: "*",
		})(request, workerEnv, ctx);
	},
};
