import { env } from "cloudflare:workers";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createLegacyMcpHandler } from "agents/mcp";
import { SoundCloudAuthError, SoundCloudClient } from "./client.js";
import { HOSTED_ICON } from "./icon.js";
import { instructions, serverInfo } from "./server.js";
import { registerTools } from "./tools.js";
import { SoundCloudHandler } from "./worker/handler.js";
import { isAccountAllowed, type Props, PropsSchema, refreshTokens } from "./worker/oauth.js";

// Stateless: every request builds a fresh server from the props OAuthProvider
// decrypts out of the grant, so rotated tokens apply on the next request and
// no Durable Object or session state lives between requests.
function createServer(workerEnv: Env, props: Props | undefined): McpServer {
	const server = new McpServer(serverInfo("soundcloud-mcp", "0.1.0", [HOSTED_ICON]), {
		instructions: instructions(
			"- The connected account is already authorized; there is no login step."
		),
	});

	// Recheck the callback's allowlist before registering tools.
	if (!isAccountAllowed([props?.username, props?.userId], workerEnv.ALLOWED_USERS)) {
		return server;
	}

	const client = new SoundCloudClient({
		getAccessToken: async () => {
			const token = props?.accessToken;
			if (!token) throw new SoundCloudAuthError();
			return token;
		},
		// Only tokenExchangeCallback may spend the single-use refresh token.
		refreshAccessToken: async () => {
			throw new SoundCloudAuthError();
		},
	});

	registerTools(server, client);
	return server;
}

const mcpHandler = {
	fetch(request: Request, workerEnv: Env, ctx: ExecutionContext) {
		// A per-request server can never write to a standalone listen stream.
		if (request.method === "GET") {
			return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } });
		}
		const server = createServer(workerEnv, PropsSchema.safeParse(ctx.props).data);
		// No session id: the SDK v1 transport then serves each request on its own.
		return createLegacyMcpHandler(server, { route: "/mcp", sessionIdGenerator: undefined })(
			request,
			workerEnv,
			ctx
		);
	},
};

export default new OAuthProvider({
	apiHandlers: {
		"/mcp": mcpHandler,
	},
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
	// Persist rotated tokens in the grant so future sessions can use them.
	tokenExchangeCallback: async (options) => {
		if (options.grantType !== "refresh_token") return;
		const props = PropsSchema.parse(options.props);
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
