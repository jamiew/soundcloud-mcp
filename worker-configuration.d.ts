// Bindings available to the Worker. Regenerate the runtime portion any time with
// `npx wrangler types`; the fields below are the ones this project relies on.
interface WorkerBindings {
	/** KV namespace backing the OAuth provider (grants, tokens, clients, state, PKCE verifiers). */
	OAUTH_KV: KVNamespace;
	/** Durable Object namespace for the SoundCloudMCP agent. */
	MCP_OBJECT: DurableObjectNamespace;
	/** SoundCloud app Client ID (set via `wrangler secret put`). */
	SOUNDCLOUD_CLIENT_ID: string;
	/** SoundCloud app Client Secret (set via `wrangler secret put`). */
	SOUNDCLOUD_CLIENT_SECRET: string;
	/** Random secret used to sign the "approved clients" cookie. */
	COOKIE_ENCRYPTION_KEY: string;
	/**
	 * Optional comma-separated allowlist of SoundCloud usernames and/or numeric
	 * user ids. Unset or empty means any SoundCloud account may connect.
	 */
	ALLOWED_USERS?: string;
}

/** What handlers receive as their `env` argument. */
interface Env extends WorkerBindings {}

// What `import { env } from "cloudflare:workers"` resolves to. The OAuth
// provider's tokenExchangeCallback gets no env argument, so it reads this.
declare namespace Cloudflare {
	interface Env extends WorkerBindings {}
}
