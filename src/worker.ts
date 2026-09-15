import { env } from "cloudflare:workers";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { SoundCloudAuthError, SoundCloudClient } from "./client.js";
import { HOSTED_ICON } from "./icon.js";
import { instructions, serverInfo } from "./server.js";
import { registerTools } from "./tools.js";
import { SoundCloudHandler } from "./worker/handler.js";
import { isAccountAllowed, type Props, refreshTokens } from "./worker/oauth.js";

// Each MCP session gets a new Durable Object. Tokens belong to the OAuth grant.
export class SoundCloudMCP extends McpAgent<Env, never, Props> {
	server = new McpServer(serverInfo("soundcloud-mcp", "0.1.0", [HOSTED_ICON]), {
		instructions: instructions(
			"- The connected account is already authorized; there is no login step."
		),
	});

	async init() {
		// Recheck the callback's allowlist before registering tools.
		if (!isAccountAllowed([this.props?.username, this.props?.userId], this.env.ALLOWED_USERS)) {
			return;
		}

		const client = new SoundCloudClient({
			// Read current props; waking the Durable Object reloads rotated tokens.
			getAccessToken: async () => {
				const token = this.props?.accessToken;
				if (!token) throw new SoundCloudAuthError();
				return token;
			},
			// Only tokenExchangeCallback may spend the single-use refresh token.
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
	// Persist rotated tokens in the grant so future sessions can use them.
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
			// Match SoundCloud's expiry so the client refreshes on time.
			accessTokenTTL: Math.max(60, Math.floor((tokens.expiresAt - Date.now()) / 1000)),
		};
	},
	// biome-ignore lint/suspicious/noExplicitAny: OAuthProvider's handler type predates Hono's ExportedHandler shape
	defaultHandler: SoundCloudHandler as any,
});
