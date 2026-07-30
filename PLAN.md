# PLAN.md

Living status doc for `soundcloud-mcp`. Two servers share this repo:

- `src/index.ts` + `src/stdio/` — the **stdio** server (Node 22+), runs locally
- `src/worker.ts` + `src/worker/` — the **remote** server on Cloudflare Workers

One pnpm package, sharing `client.ts`, `tools.ts`, `types.ts` and `server.ts`.

## Exec summary

The two servers are now one package sharing one client, one type set and one
tool registration — see "Keeping both in sync" below for what that merge
uncovered. 35 shared tools, plus 3 stdio-only login tools.

- **stdio:** 38 tools. Verified against the live API — 27/27 checks pass
  (`pnpm verify`), covering every read tool, a create/read/delete playlist
  round-trip, and the resources and templates.
- **worker:** 35 tools, deployed at <https://soundcloud-mcp.jamie-7e9.workers.dev>.
  Secrets are set. Verified end-to-end from a real MCP client — OAuth through
  `/callback`, every tool live, like/repost/follow round-trips, and a create →
  append → remove → rename → delete playlist round-trip. Re-verified after the
  single-package restructure against CI-deployed version `23a93003`.
  Deploys automatically from `main`.

  Three bugs that only appeared on the deployed worker, all fixed: the global
  `fetch` was stored unbound so every tool call died with "Illegal invocation";
  `get_recently_played` ignored `limit` (14 tracks / 49KB for a 1-track ask);
  and a strict `outputSchema` rejected an undocumented field. None was caught by
  tests, which stub `fetch` and never touch the real runtime.

## TODO

Open work lives in [issues](https://github.com/jamiew/soundcloud-mcp/issues) now,
so it is visible from outside this file:

- [#1](https://github.com/jamiew/soundcloud-mcp/issues/1) — making the hosted
  server publicly usable: the SoundCloud terms, rate limits, and directory gates
- [#2](https://github.com/jamiew/soundcloud-mcp/issues/2) — expose more of the
  API; 32 of 64 spec operations unused
- [#3](https://github.com/jamiew/soundcloud-mcp/issues/3) — `sort=asc|desc` on
  the user-tracks tools, the cheapest win on the list
- [#5](https://github.com/jamiew/soundcloud-mcp/issues/5) — project-scoped
  `.mcp.json` for development
- [#6](https://github.com/jamiew/soundcloud-mcp/issues/6) — our icon does not
  render in Claude custom connectors (upstream, nothing to do)
- [#8](https://github.com/jamiew/soundcloud-mcp/issues/8) — the worker's auth
  died after the first session. Fixed and deployed; open until it survives a
  real token expiry. The Durable Object is keyed per MCP session, so it kept
  re-seeding from a single-use refresh token the previous session had spent.
  The OAuth grant owns refreshes now

Closed, recorded so it is not rediscovered:
[#4](https://github.com/jamiew/soundcloud-mcp/issues/4) — `add_comment` has no
undo, and the API offers no delete endpoint.

Recently finished: the single-package restructure, CI autodeploy
(`DEPLOY_ENABLED` + `CLOUDFLARE_API_TOKEN` are set and the first run deployed
`23a93003`), and both redirect URIs confirmed working — stdio via `pnpm verify`
and the worker via a live tool call.

## Keeping both in sync — done

Resolved 2026-07-28 by option 3: one package, two entrypoints. `client.ts`,
`tools.ts`, `types.ts`, `server.ts` and `icon.ts` are shared and
runtime-neutral; `src/stdio/` and `src/worker/` hold only what is genuinely
specific (token file vs Durable Object, loopback login vs OAuth provider).

What the merge turned up, all of it invisible while the code was duplicated:

- the same tools had **different names** — `get_likes`/`get_playlists` on stdio
  against `get_my_likes`/`get_my_playlists` on the worker. The `get_my_*` names
  won.
- `types.ts` had drifted apart. stdio declared `avatar_url`, `description` and
  `tracks` non-null where they are nullable, and still carried the deprecated
  `stream_url`. The worker's version won.
- tool descriptions differed, so the model got better guidance from the worker
  than from stdio for the same tool.
- stdio's client had no typed errors and no 401 refresh-and-retry; the worker's
  had both. The worker's won, with a `TokenProvider` adapter over the token file.
- the worker never registered `get_user_playlists` despite having the client
  method, and was missing the `discover_new_music` prompt. Both now shared.

Net: about 1,800 lines deleted. The one thing not shared is login — the three
auth tools stay in `src/stdio/authTools.ts`, since the worker authenticates at
the transport.

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
| --- | --- |
| `GET /resolve` | permalink URL → resource. The natural entry point when someone pastes a link |
| `GET /users/{urn}/tracks` | an artist's uploads — previously only reachable via keyword search |
| `GET /users/{urn}/related` | artist-to-artist recommendations |
| `GET /users/{urn}/likes/tracks` | someone else's likes; a strong taste signal |
| `GET /me/feed/tracks` | new tracks from people you follow — the real replacement for the dead recommendations endpoint |
| `GET /me/recently-played/tracks` | listening history |
| `GET /me/tracks`, `/me/followings` | own uploads, follow graph |
| `GET /playlists/{urn}/tracks` | page a playlist without refetching it whole |
| `POST/DELETE /reposts/tracks/{urn}` | reposts, a first-class SoundCloud action we had no tool for |

### Still unexposed — 32 of 64 spec operations

Regenerate this list with `node .claude/skills/soundcloud-api-sync/audit.mjs`.
Ranked by value per unit of work; the top group is all plain GETs that reuse the
existing pagination helper.

| Endpoint | Why it matters |
| --- | --- |
| `GET /users/{urn}/web-profiles` | an artist's external links — Bandcamp, Instagram, PayPal. Tiny payload, no equivalent anywhere else. Verified live |
| `GET /tracks/{urn}/favoriters`, `/tracks/{urn}/reposters`, `/playlists/{urn}/reposters` | who liked/reposted a track — audience discovery and social proof. Verified live |
| `GET /me/reposts/tracks\|playlists`, `/users/{urn}/reposts/*` | reposts as a taste signal, often better than likes. Shipped 2026-03-24 |
| `GET /users/{urn}/followers\|followings`, `/me/followers` | the social graph in both directions; we only expose `/me/followings` |
| `GET /me/followings/{urn}` | "do I already follow X?" — 200 vs 404, worth checking before a follow write |
| `GET /me/likes/playlists`, `/users/{urn}/likes/playlists` | we only handle track likes |
| `POST/DELETE /likes/playlists/{urn}`, `/reposts/playlists/{urn}` | playlists are second-class in our tool set; tracks have both, playlists have neither |
| `GET /me/activities`, `/me/activities/all/own`, `/me/activities/tracks`, `/me/feed` | richer activity feed than `/me/feed/tracks` — includes playlist activity and your own |
| `POST /sign-out` | invalidate the token; the honest backing for a "disconnect" tool |
| `POST /tracks`, `PUT/DELETE /tracks/{urn}` | upload and manage own tracks. Multipart, up to 4GB / 24h per track. Real work, and the worker's request-size limits make it stdio-first |
| `PUT /tracks/{urn}/storefront` | Artist Storefront. Needs a creator subscription, so untestable on this account |
| `GET /tracks/{urn}/preview` | 30s preview playback; `/streams` already covers our case |

One cheap win that is not a new endpoint at all:

- **`sort=asc\|desc` on `GET /users/{urn}/tracks` and `/me/tracks`** — shipped
  2026-07-19, verified live. One optional param on two existing tools and you can
  ask for an artist's *earliest* work.

(`get_user_playlists` was the other; it is registered now.)

## Tracking API changes

SoundCloud has no versioning, no deprecation window, and no developer
newsletter. Endpoints get removed and start returning 405 with no notice — that
is how the messaging tools above died. The GitHub release notes are the only
real changelog.

Run `node .claude/skills/soundcloud-api-sync/audit.mjs --since <date>` to diff
the live spec against what we call and list release notes since a date. The
`soundcloud-api-sync` skill documents every official source and the rules that
keep biting.

Watchable feeds (no auth needed):

- `https://github.com/soundcloud/api/releases.atom` — the changelog
- `https://github.com/soundcloud/api/commits/master/openapi/api.yaml.atom` — spec
  edits, which sometimes land before the release note

Also [@SoundCloudDev](https://x.com/SoundCloudDev),
[Bluesky](https://bsky.app/profile/soundcloud.dev), and the
[Backstage blog](https://developers.soundcloud.com/blog) (no RSS).

**SoundCloud API synced through: 2026-07-19** (latest release: `sort` parameter
for user tracks). Update this line whenever the audit is run.

### The SDKs are dead — don't copy them

`soundcloud-javascript`, `soundcloud-python`, and `soundcloud-ruby` are all
unmaintained. The JS repo's README leads with "DEPRECATED - NO LONGER
MAINTAINED" and admits it is already out of sync with the API; its last real
code change was 2019 (a 2026 push was just a Renovate bot config). SoundCloud's
own guidance is to build a client from the spec, which is what both servers do.
`Widget-JS-API` and `soundcloud-custom-player` are still alive but are embed
players, not API clients.

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

## MCP protocol coverage

Audited against the 2025-11-25 spec on 2026-07-27; SDK is `@modelcontextprotocol/sdk`
1.29.0, which negotiates 2025-11-25. Both servers now implement everything worth
implementing for this shape of integration.

| Feature | State |
| --- | --- |
| Tool annotations | All 37 stdio / 34 worker tools. 23 read, 14 write, 4 destructive |
| `structuredContent` | All read tools |
| `outputSchema` | 15 list tools — the `{ collection, next_href }` envelope only |
| `resource_link` blocks | Track, playlist, and stream tools |
| Resources | `soundcloud://me/{profile,playlists,likes}` (the worker had none before) |
| Resource templates | `soundcloud://{tracks,users,playlists}/{id}` |
| Prompts | 3 stdio, 2 worker — `discover_new_music` is still stdio-only |
| Server metadata | `title`, `description`, `websiteUrl`, SVG icon, `instructions` |
| Pagination | Cursor-based, via `next_page` |

Skipped, with reasons:

- **Logging, sampling, roots** -- all deprecated by SEP-2577; implementing them
  now would be building toward removal.
- **Tasks (SEP-1686)** -- experimental, and nothing here runs long enough. The
  slowest call is `add_tracks_to_playlist`, a read plus a PUT.
- **Elicitation** -- no call needs a mid-flight prompt, and client support is
  uneven. The natural use (confirm before `delete_playlist`) is already covered
  by `destructiveHint`.
- **Completions** -- would autocomplete resource-template ids, but there is no
  endpoint that enumerates track ids, so there is nothing to complete against.
- **Per-tool icons** -- allowed by SEP-973, but 37 copies of a data URI in every
  `tools/list` response is a lot of bytes for no signal the annotations don't
  already carry.
- **`tools/list_changed`** -- the worker could hide personal tools until OAuth
  completes, but the OAuth flow gates the whole connection anyway.

The one real gotcha, which cost a live failure: `outputSchema` built from
`z.object` compiles to `additionalProperties: false` and the client validates
strictly, so `/me/feed/tracks` returning an undocumented `query_urn` broke the
call. `z.looseObject` is required. Unit tests pass either way.

## Gotchas worth remembering

See `CLAUDE.md` for the working rules. The two that cost the most time:
refresh tokens are **single-use** (persist the rotated one or auth dies), and
playlist track ids above int32 must be sent as URN strings or the API 422s.
