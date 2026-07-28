# SoundCloud MCP Server

An MCP server that gives an assistant access to the SoundCloud API — search and
discovery, your library, playlist management, and social actions.

Runs locally over stdio. Public search works with app credentials alone;
personal data and writes require a one-time browser login that persists and
auto-refreshes its token.

There is also a **remote** version for Cloudflare Workers in
[`soundcloud-mcp-cloudflare/`](soundcloud-mcp-cloudflare/) — same tools, reachable
as a URL, with browser OAuth per client instead of a local token file. A live
instance with install instructions is at
<https://soundcloud-mcp.jamie-7e9.workers.dev> (allowlisted; deploy your own).

## Setup

1. Install dependencies (both packages use pnpm):

   ```bash
   pnpm install
   ```

2. Create a SoundCloud app at https://soundcloud.com/you/apps and note the
   **Client ID** and **Client Secret**. Set the app's **Redirect URI** to match
   your `.env` (default `http://localhost:8888/callback`).

3. Copy the example env and fill it in:

   ```bash
   cp .env.example .env
   ```

4. Build:

   ```bash
   pnpm build
   ```

## Authenticate (one time, for personal data)

```bash
pnpm run auth
```

This opens your browser, captures the OAuth callback automatically, and saves
tokens to `~/.soundcloud-mcp/tokens.json` (mode 600). The token auto-refreshes,
so you normally only do this once. Use `pnpm run auth --no-browser` to print the
URL instead of opening it.

You can also log in from within a client by calling the **`connect_soundcloud`**
tool, and check state with **`auth_status`**.

## Run

Standalone (uses the local `.env`):

```bash
pnpm start
```

### Claude Desktop

1. `pnpm build` first — Claude Desktop runs the compiled `build/index.js`.
2. Open the config file (or **Settings → Developer → Edit Config**):
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
3. Add the server, using **absolute paths** and your app credentials in `env`:

   ```json
   {
     "mcpServers": {
       "soundcloud": {
         "command": "node",
         "args": ["/absolute/path/to/soundcloud-mcp/build/index.js"],
         "env": {
           "SOUNDCLOUD_CLIENT_ID": "your-client-id",
           "SOUNDCLOUD_CLIENT_SECRET": "your-client-secret"
         }
       }
     }
   }
   ```

4. Fully **quit and reopen** Claude Desktop (closing the window isn't enough).

Gotchas:

- Paths must be absolute — `~` and shell variables are not expanded.
- Claude Desktop launches from the GUI, so it may not find a version-managed
  `node` (nvm/nodenv/asdf). If the server won't start, set `"command"` to the
  absolute node path from `which node` (e.g. `nodenv which node`), such as
  `/Users/you/.nodenv/versions/22.22.0/bin/node`.
- Run `pnpm run auth` once in a terminal so personal-data tools and writes work;
  public search works without it. Tokens persist to `~/.soundcloud-mcp/tokens.json`
  independent of Claude Desktop, so you don't re-auth per client.
- Only set `SOUNDCLOUD_REDIRECT_URI` if you changed it from the default; it must
  match your SoundCloud app exactly.

Other MCP clients work the same way: run `node build/index.js` with the two
credential env vars set. The package scripts additionally load a local `.env`
natively via Node's `--env-file-if-exists` (no `dotenv` dependency; needs Node 22+).

## Tools

- **Auth:** `connect_soundcloud`, `auth_status`, `sign_out`
- **Discovery:** `resolve_url`, `search_tracks`, `search_playlists`, `search_users`,
  `get_track`, `get_user`, `get_user_tracks`, `get_user_likes`, `get_playlist`,
  `get_playlist_tracks`, `get_related_tracks`, `get_related_artists`,
  `get_stream_url`, `get_comments`, `next_page`
- **Library (login):** `get_profile`, `get_likes`, `get_playlists`, `get_my_tracks`,
  `get_my_followings`, `get_feed`, `get_recently_played`
- **Social (login):** `like_track`, `unlike_track`, `repost_track`, `unrepost_track`,
  `follow_user`, `unfollow_user`, `add_comment`
- **Playlists (login):** `create_playlist`, `update_playlist`, `add_tracks_to_playlist`,
  `remove_track_from_playlist`, `delete_playlist`

Every id argument accepts either a numeric id or a `soundcloud:tracks:123` URN.
URNs are what SoundCloud now prefers; numeric ids still work.

`get_recommended_tracks` and the six messaging tools were removed — SoundCloud
no longer serves those endpoints (405). `get_feed` and `get_related_tracks` are
what discovery looks like now; see [`PLAN.md`](PLAN.md) for the full audit.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SOUNDCLOUD_CLIENT_ID` | yes | App client ID |
| `SOUNDCLOUD_CLIENT_SECRET` | yes | App client secret |
| `SOUNDCLOUD_REDIRECT_URI` | yes | Must match the app's redirect URI exactly (default `http://localhost:8888/callback`) |
| `SOUNDCLOUD_TOKEN_FILE` | no | Token storage path (default `~/.soundcloud-mcp/tokens.json`) |
| `MCP_DEBUG` | no | Set `true` for verbose request logging to stderr |

## Architecture

- `config.ts` — env + constants
- `tokenStore.ts` — persists/refreshes user tokens on disk
- `oauth.ts` — OAuth flows (PKCE auth-code, client-credentials, refresh) + browser login
- `api.ts` — SoundCloud API client, fed an async token provider
- `tools.ts` — `registerAll(server, api)`: all tools/prompts/resources, transport-agnostic
- `index.ts` — stdio entrypoint
- `auth.ts` — one-time login CLI

Tool registration is decoupled from the stdio transport, so a future remote
(Streamable HTTP) entrypoint can reuse `registerAll` without changes.

## MCP conventions

Built against the MCP 2025-11-25 spec. Both servers implement:

- **Tool annotations** — every tool carries `title` plus
  `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`, so a client
  can tell a search from a delete before calling it. 23 read, 14 write, 4 of
  those destructive.
- **Output schemas** — list tools declare the `{ collection, next_href }`
  envelope, so a client can validate `structuredContent` and discover pagination
  without reading prose. Kept to the envelope on purpose; see `CLAUDE.md`.
- **Structured content + resource links** — read tools return
  `structuredContent` alongside text, and track/playlist tools emit
  `resource_link` blocks for permalink, artwork, and audio stream.
- **Resources and resource templates** — `soundcloud://me/{profile,playlists,likes}`
  as static resources, plus `soundcloud://tracks/{id}`, `users/{id}` and
  `playlists/{id}` as templates, so a client can attach a track as context
  without a tool call.
- **Server discovery metadata** — `title`, `description`, `websiteUrl`, an SVG
  icon, and `instructions` telling the model to resolve links first, that ids may
  be URNs, and how to page.

Deliberately skipped: logging, sampling and roots (all deprecated by SEP-2577),
tasks (experimental), and elicitation — nothing here is long-running or needs a
mid-call prompt.

OAuth is handled locally per the spec's guidance that stdio servers take
credentials from the environment rather than the transport-level OAuth flow. The
Cloudflare server does use transport-level OAuth.

## Keeping up with the SoundCloud API

SoundCloud ships API changes with no versioning, no deprecation window, and no
developer newsletter. Endpoints get retired and simply start returning 405 —
that is how this repo's messaging and recommendation tools died. Two things keep
that from rotting silently, both worth running every month or so.

**`/soundcloud-api-sync`** — a Claude Code skill that re-derives what is true
from SoundCloud's own sources. Ask it what changed, whether an endpoint still
exists, or what we could add next. It knows every official source and the rules
that keep biting. The mechanical part runs standalone:

```bash
node .claude/skills/soundcloud-api-sync/audit.mjs --since 2026-07-19
```

It fetches the live OpenAPI spec and prints what we do not implement yet, what
we call that the spec no longer lists (the dangerous direction), and the API
release notes since a date. `PLAN.md` tracks the current coverage — 32 of 64
operations — and the date we last synced through.

**`pnpm build && node scripts/verify.mjs`** — drives the built stdio server
against the live API, exercising every read tool plus a create/read/delete
playlist round-trip, and cleans up after itself.

Worth subscribing to, no auth needed:

- `https://github.com/soundcloud/api/releases.atom` — the only real changelog
- `https://github.com/soundcloud/api/commits/master/openapi/api.yaml.atom` —
  spec edits, which sometimes land before the release note

## Notes

Unofficial integration, not affiliated with SoundCloud. Use within the
[SoundCloud API Terms of Use](https://developers.soundcloud.com/docs/api/terms-of-use).
The legacy `/charts` endpoint is no longer served by the public API and has been removed.

SoundCloud publishes an OpenAPI spec and agent guidance at
[github.com/soundcloud/api](https://github.com/soundcloud/api) — that spec, not
these docs, is the source of truth for what the API still serves.
