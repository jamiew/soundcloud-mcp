import { env } from "cloudflare:workers";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { SoundCloudAuthError, SoundCloudClient } from "./client.js";
import { instructions, serverInfo } from "./server.js";
import { registerTools } from "./tools.js";
import { SoundCloudHandler } from "./worker/handler.js";
import { isAccountAllowed, type Props, refreshTokens } from "./worker/oauth.js";

// No token state of its own: the agent reads whatever the current grant holds.
// The Durable Object is keyed by MCP session id, so it is created fresh for every
// new session — anything it stored would be invisible to the next one.
export class SoundCloudMCP extends McpAgent<Env, never, Props> {
	server = new McpServer(serverInfo("soundcloud-mcp", "0.1.0"), {
		instructions: instructions(
			"- The connected account is already authorized; there is no login step."
		),
	});

	async init() {
		// Backup access gate; the primary check runs at the OAuth callback. If
		// this grant isn't allowed, register no tools at all.
		if (!isAccountAllowed([this.props?.username, this.props?.userId], this.env.ALLOWED_USERS)) {
			return;
		}

		const client = new SoundCloudClient({
			// Read at call time, not captured: the agent re-reads props whenever the
			// Durable Object wakes, so a rotated token arrives without a reconnect.
			getAccessToken: async () => {
				const token = this.props?.accessToken;
				if (!token) throw new SoundCloudAuthError();
				return token;
			},
			// Refreshing here would spend the grant's single-use refresh token
			// behind the OAuth provider's back — see tokenExchangeCallback below.
			refreshAccessToken: async () => {
				throw new SoundCloudAuthError();
			},
		});

		registerTools(this.server, client);
	}
}

export default new OAuthProvider({
	apiHandlers: {
		"/mcp": SoundCloudMCP.serve("/mcp"),
		"/sse": SoundCloudMCP.serveSSE("/sse"),
	},
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
	// The single owner of SoundCloud refreshes. Its result is written back to the
	// grant, so every session — including ones that do not exist yet — sees the
	// rotated token. Refreshing anywhere else spends a single-use token that this
	// callback then can't, which is what left the server permanently unauthorized.
	tokenExchangeCallback: async (options) => {
		if (options.grantType !== "refresh_token") return;
		const props = options.props as Props;
		const tokens = await refreshTokens({
			clientId: env.SOUNDCLOUD_CLIENT_ID,
			clientSecret: env.SOUNDCLOUD_CLIENT_SECRET,
			refreshToken: props.refreshToken,
		});
		return {
			newProps: { ...props, ...tokens },
			// Expire our token with SoundCloud's, so the client comes back for a
			// refresh exactly when the upstream one runs out.
			accessTokenTTL: Math.max(60, Math.floor((tokens.expiresAt - Date.now()) / 1000)),
		};
	},
	// biome-ignore lint/suspicious/noExplicitAny: OAuthProvider's handler type predates Hono's ExportedHandler shape
	defaultHandler: SoundCloudHandler as any,
});
