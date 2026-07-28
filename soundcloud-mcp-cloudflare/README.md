# soundcloud-mcp-cloudflare

The SoundCloud MCP server as a **remote** server on Cloudflare Workers. Clients
connect over HTTPS and log in with SoundCloud in the browser — no local install,
no `.env`, no token file on disk.

The stdio server in the parent directory is still the right choice for local
CLI use. This one exists so Claude web/desktop and other remote-MCP clients can
connect to a URL.

## How it differs from the stdio server

| | stdio (`../src`) | this worker |
| --- | --- | --- |
| Transport | stdio | Streamable HTTP (`/mcp`) + SSE (`/sse`) |
| Auth | one-time `pnpm run auth`, tokens in `~/.soundcloud-mcp/` | browser OAuth per client, tokens in a Durable Object |
| Client setup | absolute path to `build/index.js` | a URL |
| Public data without login | yes (client-credentials) | no — every session is a logged-in user |

Tool registration is a straight port, minus the endpoints SoundCloud no longer
serves and plus the ones the OpenAPI spec revealed we were missing. See
[`../PLAN.md`](../PLAN.md) for that accounting.

## Setup

1. Install:

   ```bash
   pnpm install
   ```

2. Create the KV namespace (already done for this account — the id is in
   `wrangler.jsonc`):

   ```bash
   npx wrangler kv namespace create soundcloud-mcp-OAUTH_KV
   ```

3. Set secrets:

   ```bash
   npx wrangler secret put SOUNDCLOUD_CLIENT_ID
   npx wrangler secret put SOUNDCLOUD_CLIENT_SECRET
   npx wrangler secret put COOKIE_ENCRYPTION_KEY   # openssl rand -hex 32
   npx wrangler secret put ALLOWED_USERS           # optional, see below
   ```

4. Deploy:

   ```bash
   pnpm deploy
   ```

5. **Register the redirect URI** on your SoundCloud app at
   <https://soundcloud.com/you/apps>: `https://<your-worker>.workers.dev/callback`.
   This is the step that is easy to forget — OAuth fails with a redirect
   mismatch until it matches exactly.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in, it is gitignored
pnpm dev                          # http://localhost:8789
```

`.dev.vars` is only read by `wrangler dev`; production reads `wrangler secret`.

## Connecting a client

Claude Code:

```bash
claude mcp add --transport http soundcloud https://<your-worker>.workers.dev/mcp
```

Claude web/desktop: add a custom connector pointing at the same `/mcp` URL. The
first tool call opens a SoundCloud consent screen; after that the Durable Object
holds the tokens and refreshes them.

## Access control

`ALLOWED_USERS` is a comma-separated list of SoundCloud usernames and/or numeric
user ids. Unset means **anyone with a SoundCloud account can connect to your
worker and use your API quota** — set it unless you mean to run this publicly.
The check runs at the OAuth callback, before any token is issued, and again when
the agent registers tools.

## Tools

- **Discovery:** `search_tracks`, `search_playlists`, `search_users`,
  `resolve_url`, `get_track`, `get_user`, `get_user_tracks`, `get_user_likes`,
  `get_playlist`, `get_playlist_tracks`, `get_related_tracks`,
  `get_related_artists`, `get_stream_url`, `get_comments`, `next_page`
- **Library:** `get_profile`, `get_my_likes`, `get_my_playlists`, `get_my_tracks`,
  `get_my_followings`, `get_feed`, `get_recently_played`
- **Social:** `like_track`, `unlike_track`, `repost_track`, `unrepost_track`,
  `follow_user`, `unfollow_user`, `add_comment`
- **Playlists:** `create_playlist`, `update_playlist`, `add_tracks_to_playlist`,
  `remove_track_from_playlist`, `delete_playlist`

Prompts: `analyze_music_taste`, `discover_similar_tracks`.

## Routes

| Path | Purpose |
| --- | --- |
| `/` | install instructions for humans who land on the URL |
| `/mcp` | Streamable HTTP transport (what clients connect to) |
| `/sse` | SSE transport, for older clients |
| `/authorize`, `/callback`, `/token`, `/register` | OAuth |

## Architecture

- `index.ts` — `SoundCloudMCP` Durable Object (token state + refresh) and the
  `OAuthProvider` that fronts it
- `soundcloud-handler.ts` — Hono app for `/`, `/authorize` and `/callback`
- `landing.ts` — the public install page, self-contained HTML
- `oauth.ts` — upstream SoundCloud OAuth: PKCE, code exchange, refresh, allowlist
- `soundcloud.ts` — API client: URN normalization, 401 refresh-and-retry, pagination
- `tools.ts` — MCP tool/prompt registration
- `workers-oauth-utils.ts` — approval dialog, CSRF, state binding (vendored from
  Cloudflare's demo, unmodified)

## Notes

Unofficial integration, not affiliated with SoundCloud. Use within the
[SoundCloud API Terms of Use](https://developers.soundcloud.com/docs/api/terms-of-use).
