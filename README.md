# SoundCloud MCP Server

An MCP server that gives an assistant access to the SoundCloud API — search and
discovery, your library, playlist management, social actions, and messaging.

Runs locally over stdio. Public search works with app credentials alone;
personal data and writes require a one-time browser login that persists and
auto-refreshes its token.

There is also a **remote** version for Cloudflare Workers in
[`soundcloud-mcp-cloudflare/`](soundcloud-mcp-cloudflare/) — same tools, reachable
as a URL, with browser OAuth per client instead of a local token file.

## Setup

1. Install dependencies:

   ```bash
   npm install
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
   npm run build
   ```

## Authenticate (one time, for personal data)

```bash
npm run auth
```

This opens your browser, captures the OAuth callback automatically, and saves
tokens to `~/.soundcloud-mcp/tokens.json` (mode 600). The token auto-refreshes,
so you normally only do this once. Use `npm run auth -- --no-browser` to print the
URL instead of opening it.

You can also log in from within a client by calling the **`connect_soundcloud`**
tool, and check state with **`auth_status`**.

## Run

Standalone (uses the local `.env`):

```bash
npm start
```

### Claude Desktop

1. `npm run build` first — Claude Desktop runs the compiled `build/index.js`.
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
- Run `npm run auth` once in a terminal so personal-data tools and writes work;
  public search works without it. Tokens persist to `~/.soundcloud-mcp/tokens.json`
  independent of Claude Desktop, so you don't re-auth per client.
- Only set `SOUNDCLOUD_REDIRECT_URI` if you changed it from the default; it must
  match your SoundCloud app exactly.

Other MCP clients work the same way: run `node build/index.js` with the two
credential env vars set. The `npm` scripts additionally load a local `.env`
natively via Node's `--env-file-if-exists` (no `dotenv` dependency; needs Node 22+).

## Tools

- **Auth:** `connect_soundcloud`, `auth_status`, `sign_out`
- **Discovery:** `search_tracks`, `search_playlists`, `search_users`, `get_track`,
  `get_user`, `get_playlist`, `get_related_tracks`, `get_stream_url`, `get_comments`
- **Library (login):** `get_profile`, `get_likes`, `get_playlists`
- **Social (login):** `like_track`, `unlike_track`, `follow_user`, `unfollow_user`, `add_comment`
- **Playlists (login):** `create_playlist`, `update_playlist`, `add_tracks_to_playlist`,
  `remove_track_from_playlist`, `delete_playlist`

Seven tools here are **currently broken**: `get_recommended_tracks` and the six
messaging tools call endpoints SoundCloud has removed from the public API (they
return 405). They are still registered but always error — see
[`PLAN.md`](PLAN.md) for the full audit and the replacement endpoints. The
Cloudflare version already drops them.

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

Built against the MCP 2025-06-18 spec: tools carry `title` + behavior
annotations (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`),
read tools return `structuredContent` alongside text, and track/playlist tools
emit `resource_link` blocks (permalink, artwork, audio stream) so clients can render them.
OAuth is handled locally per the spec's guidance that stdio servers take
credentials from the environment rather than the transport-level OAuth flow
(which is reserved for the future remote HTTP mode).

## Notes

Unofficial integration, not affiliated with SoundCloud. Use within the
[SoundCloud API Terms of Use](https://developers.soundcloud.com/docs/api/terms-of-use).
The legacy `/charts` endpoint is no longer served by the public API and has been removed.

SoundCloud publishes an OpenAPI spec and agent guidance at
[github.com/soundcloud/api](https://github.com/soundcloud/api) — that spec, not
these docs, is the source of truth for what the API still serves.
