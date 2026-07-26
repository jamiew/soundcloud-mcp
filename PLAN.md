# PLAN.md

Living status doc for `soundcloud-mcp`. Two servers share this repo:

- `src/` — the original **stdio** server (npm, Node 22+), runs locally
- `soundcloud-mcp-cloudflare/` — the **remote** server on Cloudflare Workers (pnpm)

## Exec summary

Both servers are updated and in sync on capability. An audit against
SoundCloud's official OpenAPI spec (July 2026) found that 7 of the stdio
server's 32 tools called endpoints the public API no longer serves, and that we
were missing about a dozen endpoints that do exist — including the ones that
best answer "show me this artist's tracks" and "recommend me something". Both
servers now drop the dead tools and expose the missing ones, and both take URNs
or numeric ids.

- **stdio:** 37 tools. Verified against the live API — 22/22 checks pass
  (`node scripts/verify.mjs`).
- **worker:** 32 tools, deployed at <https://soundcloud-mcp.jamie-7e9.workers.dev>.
  Secrets are set. Fully verified end-to-end from a real MCP client (Claude
  Code): OAuth through `/callback`, then every tool exercised live, including a
  like/repost/follow round-trip and a create → append → remove → rename → delete
  playlist round-trip. `/` serves an install page.

  Two bugs that only appeared on the deployed worker, both now fixed: the global
  `fetch` was stored unbound so every tool call died with "Illegal invocation",
  and `get_recently_played` ignored `limit` (14 tracks / 49KB for a 1-track ask).
  Neither was caught by tests, which stub `fetch` and don't hit the live API.

## TODO

- [ ] Set the worker secrets (`SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET`,
      `COOKIE_ENCRYPTION_KEY`, `ALLOWED_USERS`) — see the worker README
- [ ] Register `https://soundcloud-mcp.jamie-7e9.workers.dev/callback` as a
      redirect URI on the SoundCloud app, alongside the localhost one
- [ ] Verify the end-to-end OAuth flow from a real client
- [ ] Confirm the SoundCloud app accepts both redirect URIs; if it is
      one-at-a-time, stdio and remote cannot share an app and one needs its own
- [ ] Set `DEPLOY_ENABLED` repo variable + `CLOUDFLARE_API_TOKEN` secret to turn
      on CI deploys (the workflow skips green until then)
- [ ] Decide on deduplicating the two servers — see "Keeping both in sync"

## Keeping both in sync

Right now `src/api.ts` + `src/tools.ts` and
`soundcloud-mcp-cloudflare/src/soundcloud.ts` + `tools.ts` are near-duplicates.
Every API change means the same edit twice, which is exactly how the two drift.

The good news: the duplication is nearly all shareable. The client is plain
`fetch` and the tool definitions are transport-agnostic — both run unmodified on
Node 22 and on Workers. Only three things are genuinely runtime-specific:
the token store (disk vs Durable Object), the login flow (loopback HTTP server
vs OAuth provider), and the entrypoint.

Options, cheapest first:

1. **Leave it duplicated, keep this doc honest.** Zero work. Fine while both are
   changing fast; bad once they are stable and drift is silent.
2. **Shared `core/` directory, two thin entrypoints.** Move the client, types
   and tool registration into `core/`, have both servers import it. ~1 hour.
   The tool layer already takes an injected token provider, so this is mostly
   moving files. Best value.
3. **One package, two entrypoints.** Collapse to a single `package.json` with
   `src/stdio.ts` and `src/worker.ts`. Simplest mental model but forces one
   toolchain (pnpm + Workers types) onto the Node build, which is friction for
   the npm-published stdio path.

A long-lived branch is the one option worth ruling out: the changes are
additive to shared files, so it would be a permanent merge conflict.
Recommendation is 2, once the endpoint churn settles.

## What the API audit found

Source of truth: <https://github.com/soundcloud/api> (`openapi/api.yaml`, 64
operations) plus SoundCloud's `Agents.md` and the API guide. Verified against
the live API with the stdio server on 2026-07-25.

### Dead — removed from both servers

Not in the spec; the live API returns **405**:

- `/me/recommended/tracks` → `get_recommended_tracks`
- `/me/conversations*` → all six messaging tools (`get_conversations`,
  `get_conversation`, `get_messages`, `send_message`, `start_conversation`,
  `mark_conversation_read`)

`/charts` was already removed in an earlier pass. The pattern is consistent:
SoundCloud has been retiring personalization and social-graph endpoints from the
public API.

### Missing — endpoints that exist and we did not expose

Now exposed by both servers:

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
most likely to bite. Our tool count (37 stdio / 32 worker, all live) is the largest of the set.

## Gotchas worth remembering

See `CLAUDE.md` for the working rules. The two that cost the most time:
refresh tokens are **single-use** (persist the rotated one or auth dies), and
playlist track ids above int32 must be sent as URN strings or the API 422s.
