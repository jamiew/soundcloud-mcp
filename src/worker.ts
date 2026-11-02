import OAuthProvider, { type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createLegacyMcpHandler } from "agents/mcp";
import { SoundCloudAuthError, SoundCloudClient } from "./client.js";
import { HOSTED_ICON } from "./icon.js";
import { instructions, serverInfo } from "./server.js";
import { registerTools } from "./tools.js";
import { SoundCloudHandler } from "./worker/handler.js";
import {
	isAccountAllowed,
	type Props,
	PropsSchema,
	refreshTokens,
	writesEnabled,
} from "./worker/oauth.js";
import { deleteUserGrants, registerSignOut } from "./worker/signOut.js";

// OAuthProvider adds its helpers to env before calling API handlers.
type McpEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

// Stateless: every request builds a fresh server from the props OAuthProvider
// decrypts out of the grant, so rotated tokens apply on the next request and
// no Durable Object or session state lives between requests.
function createServer(
	workerEnv: McpEnv,
	ctx: ExecutionContext,
	props: Props | undefined
): McpServer {
	const server = new McpServer(serverInfo("soundcloud-mcp", "0.1.0", [HOSTED_ICON]), {
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

const mcpHandler = {
	fetch(request: Request, workerEnv: McpEnv, ctx: ExecutionContext) {
		// A per-request server can never write to a standalone listen stream.
		if (request.method === "GET") {
			return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } });
		}
		const server = createServer(workerEnv, ctx, PropsSchema.safeParse(ctx.props).data);
		// No session id: the SDK v1 transport then serves each request on its own.
		return createLegacyMcpHandler(server, { route: "/mcp", sessionIdGenerator: undefined })(
			request,
			workerEnv,
			ctx
		);
	},
};

// OAuthProvider 1.x binds every token to one resource. Use `<origin>/mcp`, the
// resource 0.x advertised for this route, so existing grants keep working on
// any hostname, including `wrangler dev`.
const providers = new Map<string, OAuthProvider>();

function providerFor(resource: string): OAuthProvider {
	let provider = providers.get(resource);
	if (provider) return provider;
	provider = new OAuthProvider({
		resourceMetadata: { resource },
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
				clientId: options.env.SOUNDCLOUD_CLIENT_ID,
				clientSecret: options.env.SOUNDCLOUD_CLIENT_SECRET,
				refreshToken: props.refreshToken,
			});
			return {
				newProps: { ...props, ...tokens },
				// Match SoundCloud's expiry so the client refreshes on time.
				accessTokenTTL: Math.max(60, Math.floor((tokens.expiresAt - Date.now()) / 1000)),
			};
		},
		defaultHandler: SoundCloudHandler,
	});
	providers.set(resource, provider);
	return provider;
}

export default {
	fetch(request, workerEnv, ctx) {
		return providerFor(`${new URL(request.url).origin}/mcp`).fetch(request, workerEnv, ctx);
	},
} satisfies ExportedHandler<Env>;
