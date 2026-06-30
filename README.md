# SoundCloud MCP Server

An MCP server that gives an assistant access to the SoundCloud API — search and
discovery, your library, playlist management, social actions, and messaging.

Runs locally over stdio. Public search works with app credentials alone;
personal data and writes require a one-time browser login that persists and
auto-refreshes its token.

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
so you normally only do this once. Use `npm run auth --no-browser` to print the
URL instead of opening it.

You can also log in from within a client by calling the **`connect_soundcloud`**
tool, and check state with **`auth_status`**.

## Run

```bash
npm start
```

Or point your MCP client at `build/index.js` and pass credentials via the
client's `env` block (no `.env` needed):

```json
{
  "mcpServers": {
    "soundcloud": {
      "command": "node",
      "args": ["/absolute/path/to/soundcloud-mcp/build/index.js"],
      "env": {
        "SOUNDCLOUD_CLIENT_ID": "...",
        "SOUNDCLOUD_CLIENT_SECRET": "...",
        "SOUNDCLOUD_REDIRECT_URI": "http://localhost:8888/callback"
      }
    }
  }
}
```

The `npm` scripts load a local `.env` natively via Node's `--env-file-if-exists`
(no `dotenv` dependency). Requires Node 22+.

## Tools

- **Auth:** `connect_soundcloud`, `auth_status`, `sign_out`
- **Discovery:** `search_tracks`, `search_playlists`, `search_users`, `get_track`,
  `get_user`, `get_playlist`, `get_related_tracks`, `get_comments`
- **Library (login):** `get_profile`, `get_likes`, `get_playlists`, `get_recommended_tracks`
- **Social (login):** `like_track`, `unlike_track`, `follow_user`, `unfollow_user`, `add_comment`
- **Playlists (login):** `create_playlist`, `update_playlist`, `add_tracks_to_playlist`,
  `remove_track_from_playlist`, `delete_playlist`
- **Messaging (login):** `get_conversations`, `get_conversation`, `get_messages`,
  `send_message`, `start_conversation`, `mark_conversation_read`

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

## Notes

Unofficial integration, not affiliated with SoundCloud. Use within the
[SoundCloud API Terms of Use](https://developers.soundcloud.com/docs/api/terms-of-use).
The legacy `/charts` endpoint is no longer served by the public API and has been removed.
