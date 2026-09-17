# Plan

One package serves local stdio and Cloudflare Workers clients through shared API
and tool code. Setup is in [README.md](README.md); operational rules are in
[CLAUDE.md](CLAUDE.md).

## Work

Track current status in [GitHub issues](https://github.com/jamiew/soundcloud-mcp/issues):

- [#1](https://github.com/jamiew/soundcloud-mcp/issues/1): public hosting, API
  terms, shared rate limits, and directory requirements.
- [#2](https://github.com/jamiew/soundcloud-mcp/issues/2): expand API coverage
  using the dated gap list below.
- [#5](https://github.com/jamiew/soundcloud-mcp/issues/5): project-scoped
  `.mcp.json` for development.
- [#6](https://github.com/jamiew/soundcloud-mcp/issues/6): Claude custom connector
  icon support; tracked as a client limitation.
- [#8](https://github.com/jamiew/soundcloud-mcp/issues/8): confirm worker auth
  survives token expiry across sessions. The fix gives the OAuth grant sole
  ownership of refreshes, not the per-session Durable Object.
- [#9](https://github.com/jamiew/soundcloud-mcp/issues/9): refresh the API audit
  below; do this before expanding coverage.
- [#10](https://github.com/jamiew/soundcloud-mcp/issues/10): plan a path off
  `McpAgent`, which upstream has deprecated and feature-frozen.
- [#11](https://github.com/jamiew/soundcloud-mcp/issues/11): raise the worker
  compatibility date, currently 2025-03-10.

Track sorting ([#3](https://github.com/jamiew/soundcloud-mcp/issues/3)) is
implemented: `get_user_tracks` and `get_my_tracks` accept `sort=asc|desc`.
Comments have no public delete endpoint
([#4](https://github.com/jamiew/soundcloud-mcp/issues/4)); no undo tool is planned.

## API audit

**SoundCloud API synced through: 2026-07-19** (latest release covered: track
sorting). This is the previous audit, not a fresh upstream check.

Sources: [OpenAPI spec](https://github.com/soundcloud/api) (`openapi/api.yaml`),
SoundCloud's `Agents.md` in that repository, and the
[API guide](https://developers.soundcloud.com/docs/api/guide). The recorded live
stdio checks ran on 2026-07-25. The audit counted 64 operations, with 32 unused;
rerun it before treating those counts or gaps as current.

### Removed endpoints

The audit found no spec entries for `/me/recommended/tracks` or
`/me/conversations*`; live requests returned 405. Their recommendation and six
messaging tools were removed. `/charts` had already been removed.

Discovery instead uses related tracks, related artists, and the follow feed.
For recommendations, seed related tracks from likes and filter the results.

### Coverage gaps

These operations were unexposed at the recorded audit. Start with small reads
that reuse pagination; check the current spec before implementing any row.

| Endpoint | Use or constraint |
| --- | --- |
| `GET /users/{urn}/web-profiles` | External artist links; verified live in the audit |
| `GET /tracks/{urn}/favoriters`, `/tracks/{urn}/reposters`, `/playlists/{urn}/reposters` | Audience discovery; verified live in the audit |
| `GET /me/reposts/tracks\|playlists`, `/users/{urn}/reposts/*` | Repost history; released upstream 2026-03-24 |
| `GET /users/{urn}/followers\|followings`, `/me/followers` | Social graph; only `/me/followings` is exposed |
| `GET /me/followings/{urn}` | Check follow state through 200 or 404 |
| `GET /me/likes/playlists`, `/users/{urn}/likes/playlists` | Playlist likes |
| `POST/DELETE /likes/playlists/{urn}`, `/reposts/playlists/{urn}` | Like and repost playlists |
| `GET /me/activities`, `/me/activities/all/own`, `/me/activities/tracks`, `/me/feed` | Broader activity feeds |
| `POST /sign-out` | Revoke the upstream token |
| `POST /tracks`, `PUT/DELETE /tracks/{urn}` | Upload and manage tracks; multipart, up to 4 GB/24 hours per track; worker request limits favor stdio |
| `PUT /tracks/{urn}/storefront` | Requires a creator subscription; not tested on this account |
| `GET /tracks/{urn}/preview` | Preview playback; `/streams` already covers current needs |

The servers already expose URL resolution, artist uploads and likes, related
artists, the follow feed, listening history, own uploads and followings,
playlist-track pagination, and track reposts.

### Refreshing the audit

Use the `soundcloud-api-sync` skill and its script:

```bash
node .claude/skills/soundcloud-api-sync/audit.mjs --since 2026-07-19
```

The script compares live spec operations with client calls and lists release
notes. Update the gap table and synced-through date only after an audit.

Watch [release notes](https://github.com/soundcloud/api/releases.atom) and
[spec edits](https://github.com/soundcloud/api/commits/master/openapi/api.yaml.atom).
Other sources include [SoundCloudDev](https://x.com/SoundCloudDev),
[Bluesky](https://bsky.app/profile/soundcloud.dev), and the
[developer blog](https://developers.soundcloud.com/blog).
The official Ruby, Python, and JavaScript API SDKs are unmaintained; do not use
them as references.

## MCP scope

The protocol review on 2026-07-27 covered MCP 2025-11-25. Both transports share
annotations, structured content, resource links, resources, templates, prompts,
and server metadata. List output schemas allow extra fields and describe only
the result envelope.

Tasks, elicitation, completions, per-tool icons, and dynamic tool-list changes
remain out of scope without a concrete need. See `package.json` for current SDK
versions; this document does not establish current upstream protocol support.
