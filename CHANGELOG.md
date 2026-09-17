# Changelog

## 2026-09-17

- Updated dependencies, TypeScript, Vitest, and CI actions. Requires Node 22.18+
  or 24.11+. Pinned pnpm and patched two vulnerable transitive dependencies.
- Fixed the dev watch target, and made `pnpm verify` portable across clones and
  exit non-zero when a check fails.
- Shortened docs, tool descriptions, prompts, and worker pages. Fixed invalid
  heading markup on the consent page.
- Errors returned to clients and browsers no longer include upstream response
  bodies or exception text; details are logged server-side.
- Worker OAuth now requires S256 PKCE for public clients.
- Refreshed the SoundCloud API audit through 2026-09-17. `get_stream_url` now
  links the HLS stream and falls back to the MP3 preview, since SoundCloud
  removed the progressive `http_mp3_128_url` on 2026-08-12. `resolve_url`
  notes that station links resolve to system playlists.
- Removed `PLAN.md`. The synced-through date now lives in the
  `soundcloud-api-sync` skill and the coverage gap list in issue #2.

## 2026-07-30

- Fixed worker auth across MCP sessions. The OAuth grant now owns SoundCloud
  refreshes through `tokenExchangeCallback` and persists rotated tokens for
  future sessions. Access-token lifetimes follow SoundCloud's expiry.
- Removed token state from the session-scoped Durable Object, which had reused
  spent single-use refresh tokens.

## 2026-07-28

- Added worker autodeploy on pushes to `main`, without path filters.
- Replaced SoundCloud's logo on the consent page with the project's own mark and
  an unofficial-integration notice. Clarified that `next_page` targets SoundCloud.
- Moved open work to GitHub issues.
- Merged `soundcloud-mcp-cloudflare/` into the main package at `src/worker.ts`
  and `src/worker/`. Both transports now share the client, types, tools, prompts,
  resources, metadata, and icon.
- **Breaking:** renamed stdio `get_likes` and `get_playlists` to `get_my_likes`
  and `get_my_playlists` to match the worker.
- Corrected nullable response fields and removed deprecated `stream_url` typing.
  Added typed errors and 401 refresh-and-retry to stdio.
- Added `get_user_playlists` and `discover_new_music` to the worker.
- Consolidated pnpm, Biome, Vitest, and CI. Removed the unused Workers test pool;
  retained separate Node and Workers typechecks. CI now checks worker bundling.

## 2026-07-27

- Added loose output schemas for list envelopes. Extra upstream fields no longer
  cause client-side schema failures.
- Added MCP discovery metadata, instructions, an SVG icon, and resource templates
  for tracks, users, and playlists. Added personal resources to the worker.
- Added the install-page favicon, Open Graph tags, and `/icon.svg`.
- Documented the API audit workflow and live-worker verification rules.

## 2026-07-26

- Bound global `fetch` correctly for Workers, fixing tool calls that failed with
  "Illegal invocation" despite passing Node tests.
- Made `get_recently_played` honor `limit` by trimming the upstream response in
  both transports.
- Added the `soundcloud-api-sync` skill and method-aware spec/release audit script.
  Recorded API coverage and the synced-through date in `PLAN.md`.
- Added the worker install page.

## 2026-07-25

- Added a remote Workers server with OAuth 2.1 PKCE and client-registration
  approval. Its original Durable Object token storage was replaced on 2026-07-30.
- Removed recommendations and six messaging tools whose retired endpoints
  returned 405.
- Adopted URN paths while accepting numeric IDs at the client boundary.
- Added URL resolution, artist uploads and likes, related artists, the follow
  feed, listening history, and track reposts.

## 2026-07-01

- Documented Claude Desktop setup.

## 2026-06-30

- Added MCP tool titles, behavior annotations, structured results, and resource
  links. Separated tool registration from stdio transport.
- Added persistent stdio auth and token refresh, plus `get_stream_url`.
- Fixed playlist writes for track IDs above int32 by sending URN strings.
- Added Biome and Vitest. Replaced `dotenv` with Node's native environment loading.

## 2025-01-26

- Added the first local OAuth callback server and token exchange.
