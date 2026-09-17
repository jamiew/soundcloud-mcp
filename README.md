# SoundCloud MCP Server

Search SoundCloud, discover music, manage playlists, and use your library from an
MCP client. This unofficial integration is not affiliated with SoundCloud. Follow
[SoundCloud's API terms](https://developers.soundcloud.com/docs/api/terms-of-use).

One package supports two transports:

| | Local server | Cloudflare Worker |
| --- | --- | --- |
| Transport | stdio | Streamable HTTP (`/mcp`), legacy SSE (`/sse`) |
| Auth | App credentials; user login for personal data | Browser OAuth for every user |
| Token storage | Local file | OAuth grant in KV; not the session Durable Object |
| Client setup | Run `build/index.js` | Connect to the worker URL |

The [hosted worker](https://soundcloud-mcp.jamie-7e9.workers.dev) is allowlisted.
Deploy your own for other accounts.

## Local setup

Requires Node 22.18+ or 24.11+ LTS and pnpm. See `package.json` for exact versions.

1. Create an app at <https://soundcloud.com/you/apps>. Save its client ID and
   secret. Register `http://localhost:8888/callback` as the redirect URI, or set a
   matching custom URI below.
2. Install and configure:

   ```bash
   pnpm install
   cp .env.example .env
   ```

   Fill in the app credentials in `.env`.
3. Build and run:

   ```bash
   pnpm build
   pnpm start
   ```

For personal data and writes, run `pnpm run auth`. It opens a browser and saves
rotating tokens to `~/.soundcloud-mcp/tokens.json` with mode `600`. Use
`pnpm run auth --no-browser` to print the login URL. You can also use the
`connect_soundcloud` and `auth_status` tools. Public search uses cached
client-credentials tokens without user login.

### Claude Code

The repo's `.mcp.json` registers this server as `soundcloud-local`. Run
`pnpm build`, fill in `.env` at the repo root, then start `claude` in the repo
and approve the project server when prompted. Its paths use
`${CLAUDE_PROJECT_DIR:-.}`, which falls back to `.` because Claude Code runs the
server from the project root, so no absolute paths are needed. Login tokens
still live in `~/.soundcloud-mcp/tokens.json`.

### Claude Desktop

Open **Settings > Developer > Edit Config** and add:

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

Fully quit and reopen Claude Desktop. Other stdio clients use the same command
and environment variables. Build before connecting; clients run JavaScript, not
TypeScript. Paths must be absolute: clients do not expand `~` or shell variables.
If a GUI client cannot find Node, use its absolute path from `which node`.

The config file is at:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Local environment

`pnpm start` and `pnpm run auth` load `.env` through Node. Direct
`node build/index.js` calls need environment variables supplied by the client.

| Variable | Purpose |
| --- | --- |
| `SOUNDCLOUD_CLIENT_ID` | Required app client ID |
| `SOUNDCLOUD_CLIENT_SECRET` | Required app secret |
| `SOUNDCLOUD_REDIRECT_URI` | Defaults to `http://localhost:8888/callback`; must match the app |
| `SOUNDCLOUD_TOKEN_FILE` | Defaults to `~/.soundcloud-mcp/tokens.json` |
| `MCP_DEBUG` | Set `true` for verbose stderr logging |

## Worker setup

1. Run `pnpm install`. Set your worker name in `wrangler.jsonc`.
2. Create a KV namespace:

   ```bash
   pnpm exec wrangler kv namespace create soundcloud-mcp-OAUTH_KV
   ```

   Put the returned ID in `wrangler.jsonc` under the `OAUTH_KV` binding.
   Keep the Durable Object binding and migrations.
3. Set each secret with `pnpm exec wrangler secret put <NAME>`:
   - `SOUNDCLOUD_CLIENT_ID`
   - `SOUNDCLOUD_CLIENT_SECRET`
   - `COOKIE_ENCRYPTION_KEY`: generate with `openssl rand -hex 32`
   - `ALLOWED_USERS`: comma-separated SoundCloud usernames or numeric IDs
4. Register `https://<your-worker>.workers.dev/callback` on your SoundCloud app.
   It must match exactly.
5. Run `pnpm worker:deploy`, then connect your MCP client to
   `https://<your-worker>.workers.dev/mcp` and complete browser OAuth.

For local development, copy `.dev.vars.example` to `.dev.vars`, fill it in, and
run `pnpm worker:dev` at `http://localhost:8789`. Register its `/callback` URL
when testing local OAuth.

CI deploys pushes to `main` when the repository variable `DEPLOY_ENABLED` is
`true` and secret `CLOUDFLARE_API_TOKEN` is set. Forks must also set their account
ID in `.github/workflows/ci.yml`. Reconnect clients after deploying new tools;
clients cache the tool list.

**Set `ALLOWED_USERS` unless you intend to offer public access.** Empty or unset
allows any SoundCloud account to use your API quota. Access is checked at the
OAuth callback and tool registration. Public hosting also needs a review of
SoundCloud's terms and shared rate limits; see
[#1](https://github.com/jamiew/soundcloud-mcp/issues/1).

The worker serves an install page at `/`, an icon at `/icon.svg`, and OAuth at
`/authorize`, `/callback`, `/token`, and `/register`. `/sse` supports older clients.

## Tools

Both servers share these tools. Only the local server exposes login tools.

| Group | Tools |
| --- | --- |
| Local auth | `connect_soundcloud`, `auth_status`, `sign_out` |
| Search | `resolve_url`, `search_tracks`, `search_playlists`, `search_users` |
| Discovery | `get_track`, `get_user`, `get_user_tracks`, `get_user_playlists`, `get_user_likes`, `get_related_tracks`, `get_related_artists` |
| Playback and browsing | `get_playlist`, `get_playlist_tracks`, `get_stream_url`, `get_comments`, `next_page` |
| Library (login) | `get_profile`, `get_my_likes`, `get_my_playlists`, `get_my_tracks`, `get_my_followings`, `get_feed`, `get_recently_played` |
| Social (login) | `like_track`, `unlike_track`, `repost_track`, `unrepost_track`, `follow_user`, `unfollow_user`, `add_comment` |
| Playlists (login) | `create_playlist`, `update_playlist`, `add_tracks_to_playlist`, `remove_track_from_playlist`, `delete_playlist` |

- IDs accept numbers or URNs such as `soundcloud:tracks:123`; prefer URNs.
- `get_user_tracks` and `get_my_tracks` accept `sort="asc"` or `sort="desc"`.
- Pass `next_href` to `next_page` for cursor pagination. Use SoundCloud API URLs
  only; authenticated requests include your token.
- Playlist track changes replace the full tracklist. Comments have no delete
  tool or public API endpoint; treat them as permanent.
- Stream URLs expire, and blocked tracks have no stream. Full tracks stream over
  HLS; the only MP3 is a short preview.

Tools provide behavior annotations, structured results, and resource links.
Resources include `soundcloud://me/{profile,playlists,likes}` and templates for
`soundcloud://{tracks,users,playlists}/{id}`.

## Development

Shared API and MCP code lives in `src/{client,tools,types,server,icon}.ts`.
`src/index.ts` and `src/stdio/` handle local auth and transport;
`src/worker.ts` and `src/worker/` handle Workers OAuth and HTTP.

- `pnpm check`: lint, Markdown lint, both typechecks, and unit tests.
- `pnpm verify`: build and check the live stdio server, including read tools,
  resources, and a temporary playlist create/read/delete cycle. Requires login
  and writes to the connected account.
- `pnpm exec wrangler deploy --dry-run`: bundle the worker without deploying.
  Unit tests do not verify the deployed Workers runtime.

See [CLAUDE.md](CLAUDE.md) for safety and verification rules and
[GitHub issues](https://github.com/jamiew/soundcloud-mcp/issues) for open work.
Use the `soundcloud-api-sync` skill before adding endpoints or checking upstream
changes. It records the synced-through date; issue #2 holds the coverage gaps.
The standalone audit is:

```bash
node .claude/skills/soundcloud-api-sync/audit.mjs --since 2026-09-16
```

The [official spec](https://github.com/soundcloud/api) is authoritative. Track
[release notes](https://github.com/soundcloud/api/releases.atom) and
[spec edits](https://github.com/soundcloud/api/commits/master/openapi/api.yaml.atom).

## Contributors

- [@jamiew](https://github.com/jamiew)
- [@c436zhan](https://github.com/c436zhan)
