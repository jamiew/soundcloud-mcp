import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { SoundCloudHandler } from "./worker/handler.js";
import { mcpHandler } from "./worker/mcp.js";
import { PropsSchema, refreshTokens } from "./worker/oauth.js";

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
