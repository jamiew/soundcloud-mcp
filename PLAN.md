# PLAN.md

Living status doc for `soundcloud-mcp`. Two servers share this repo:

- `src/` — the original **stdio** server (npm, Node 22+), runs locally
- `soundcloud-mcp-cloudflare/` — the **remote** server on Cloudflare Workers (pnpm)

## Exec summary

The stdio server works and is in daily use. An audit against SoundCloud's
official OpenAPI spec (July 2026) found that 7 of its 32 tools call endpoints
the public API no longer serves, and that we were missing about a dozen
endpoints that do exist — including the ones that best answer "show me this
artist's tracks" and "recommend me something".

The Cloudflare worker is built, tested, and builds clean. It ports the live
tools, drops the dead ones, and adds the missing ones. It is **not yet
deployed** — see TODO.

## TODO

- [ ] Set the three worker secrets (`SOUNDCLOUD_CLIENT_ID`,
      `SOUNDCLOUD_CLIENT_SECRET`, `COOKIE_ENCRYPTION_KEY`) and `ALLOWED_USERS`
- [ ] `pnpm deploy`, then register `https://<worker>.workers.dev/callback` as a
      redirect URI on the SoundCloud app
- [ ] Verify the end-to-end OAuth flow from a real client
- [ ] Decide whether the SoundCloud app can hold both the localhost and worker
      redirect URIs; if it is one-at-a-time, the stdio and remote servers cannot
      both authenticate from the same app and one needs its own
- [ ] Backport to the stdio server: delete the 7 dead tools, switch ids to URNs,
      add `resolve_url` / `get_user_tracks` / `get_feed`
- [ ] Set `DEPLOY_ENABLED` repo variable + `CLOUDFLARE_API_TOKEN` secret to turn
      on CI deploys (the workflow skips green until then)

## What the API audit found

Source of truth: <https://github.com/soundcloud/api> (`openapi/api.yaml`, 64
operations) plus SoundCloud's `Agents.md` and the API guide. Verified against
the live API with the stdio server on 2026-07-25.

### Dead — remove from the stdio server

Not in the spec; the live API returns **405**:

- `/me/recommended/tracks` → `get_recommended_tracks`
- `/me/conversations*` → all six messaging tools (`get_conversations`,
  `get_conversation`, `get_messages`, `send_message`, `start_conversation`,
  `mark_conversation_read`)

`/charts` was already removed in an earlier pass. The pattern is consistent:
SoundCloud has been retiring personalization and social-graph endpoints from the
public API.

### Missing — endpoints that exist and we did not expose

Added in the worker, still absent from stdio:

| Endpoint | Why it matters |
|---|---|
| `GET /resolve` | permalink URL → resource. The natural entry point when someone pastes a link |
| `GET /users/{urn}/tracks` | an artist's uploads — previously only reachable via keyword search |
| `GET /users/{urn}/related` | artist-to-artist recommendations |
| `GET /users/{urn}/likes/tracks` | someone else's likes; a strong taste signal |
| `GET /me/feed/tracks` | new tracks from people you follow — the real replacement for the dead recommendations endpoint |
| `GET /me/recently-played/tracks` | listening history |
| `GET /me/tracks`, `/me/followings` | own uploads, follow graph |
| `GET /playlists/{urn}/tracks` | page a playlist without refetching it whole |
| `POST/DELETE /reposts/tracks/{urn}` | reposts, a first-class SoundCloud action we had no tool for |

Still unexposed on both, low priority: `/me/activities`, `/me/reposts/*`,
`/me/likes/playlists`, `/tracks/{urn}/favoriters|reposters`,
`/users/{urn}/web-profiles`, `POST /tracks` (upload).

### Recommendations, honestly

There is no personalized recommendation endpoint any more. What exists:

1. `GET /tracks/{urn}/related` — the main surface, seed it with a track
2. `GET /users/{urn}/related` — artist neighbours
3. `GET /me/feed/tracks` — follow-graph activity

So "recommend me something" is best served by reading likes, seeding
`related`, and filtering — not by one call.

## Competitive survey (July 2026)

No official SoundCloud MCP server exists; SoundCloud's own AI page ships a spec
and a system-prompt template instead. On GitHub the field is thin — a dozen
repos, nearly all under 10 stars:

- **marcellkehmstedt/soundcloud-mcp-server** (TS) — the closest peer. 10 tools,
  playlist-focused, remote over HTTP but requires you to run your own
  public HTTPS host with its own hand-rolled login UI. Our Cloudflare approach
  removes that requirement entirely.
- **arnavsurve/scdl-mcp**, **jojoprison/mcp-music-forge** (Python) — downloaders
  wrapping `scdl`/`yt-dlp`, not the official API. Different product.
- **struktured-labs**, **David-J-Shibley**, **khandrew1** — early scaffolds,
  little implemented.
- **ag2-mcp-servers/soundcloud-public-api-specification** — auto-generated from
  the OpenAPI spec. Complete but undifferentiated; every endpoint becomes a
  tool, which is the wrong shape for an agent.
- **polaroteam/moltdj-skill** — not SoundCloud at all; an AI-music platform
  positioning itself as "SoundCloud for agents". Interesting as a signal, not
  as a reference.

Nothing worth copying architecturally. Nobody else uses URNs, exposes
`/resolve`, or handles the rotating refresh token correctly — the three things
most likely to bite. Our tool count (32 live) is already the largest of the set.

## Gotchas worth remembering

See `CLAUDE.md` for the working rules. The two that cost the most time:
refresh tokens are **single-use** (persist the rotated one or auth dies), and
playlist track ids above int32 must be sent as URN strings or the API 422s.
