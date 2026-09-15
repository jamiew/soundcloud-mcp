// Project bindings. Runtime types come from @cloudflare/workers-types.
interface WorkerBindings {
	/** OAuth grants, tokens, clients, state, and PKCE verifiers. */
	OAUTH_KV: KVNamespace;
	/** SoundCloudMCP Durable Objects. */
	MCP_OBJECT: DurableObjectNamespace;
	/** SoundCloud client ID. Set with `pnpm exec wrangler secret put`. */
	SOUNDCLOUD_CLIENT_ID: string;
	/** SoundCloud client secret. Set with `pnpm exec wrangler secret put`. */
	SOUNDCLOUD_CLIENT_SECRET: string;
	/** Secret for signing client approval cookies. */
	COOKIE_ENCRYPTION_KEY: string;
	/** Allowed usernames or numeric user IDs, comma-separated. Empty allows all accounts. */
	ALLOWED_USERS?: string;
}

/** Bindings passed to request handlers. */
interface Env extends WorkerBindings {}

// tokenExchangeCallback imports env because it receives no env argument.
declare namespace Cloudflare {
	interface Env extends WorkerBindings {}
}
