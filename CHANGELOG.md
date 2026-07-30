# Changelog

## 2026-07-28

### Autodeploy

- Pushing to `main` now deploys the worker. Verified end to end: CI green,
  version `23a93003` live, and a real tool call against the deployed server.
- Deliberately not filtered by path — a docs-only push redeploys an identical
  bundle for free, while a filter that misreads a code change as docs silently
  fails to deploy.

### Branding and terms

- The OAuth consent screen was hotlinking SoundCloud's own logo, which their API
  terms forbid where it implies endorsement. It serves our mark now and says
  "unofficial".
- `next_page` takes a freeform URL, so its description names the target API —
  Anthropic's directory review rejects freeform-path tools that don't.

### Open work moved to issues

`PLAN.md`'s TODO list is now [GitHub issues](https://github.com/jamiew/soundcloud-mcp/issues),
linked from the doc. Notable: publishing the server publicly runs into
SoundCloud's terms, a per-`client_id` rate limit and two Claude directory gates
([#1](https://github.com/jamiew/soundcloud-mcp/issues/1)); the worker's auth
lapses and needs a manual reconnect
([#8](https://github.com/jamiew/soundcloud-mcp/issues/8)).

Our `icons` metadata is correct but Claude does not render it for custom
connectors yet — that is upstream
([#6](https://github.com/jamiew/soundcloud-mcp/issues/6)).

### One package, two servers

`soundcloud-mcp-cloudflare/` is gone. The worker is now `src/worker.ts` +
`src/worker/` in the same package, and both servers share `client.ts`,
`tools.ts`, `types.ts`, `server.ts` and `icon.ts`. About 1,800 lines deleted.

Keeping two copies had let them drift in ways nobody could see:

- **The same tools had different names.** stdio registered `get_likes` and
  `get_playlists`; the worker had `get_my_likes` and `get_my_playlists`. A
  prompt written against one broke against the other. The `get_my_*` names win,
  so stdio's two tools are renamed.
- **`types.ts` disagreed with itself.** stdio declared `avatar_url`,
  `description` and `tracks` non-null where they are nullable, and still carried
  the deprecated `stream_url` — the kind of lie that crashes on a private track.
- **Descriptions differed per tool**, so the model got better guidance from one
  server than the other for identical functionality.
- stdio's client had neither typed errors nor 401 refresh-and-retry; the
  worker's had both, and won.
- The worker never registered `get_user_playlists` despite having the client
  method, and lacked the `discover_new_music` prompt. Both are shared now.

Also: one pnpm install, one biome config (tabs), one Node vitest —
`@cloudflare/vitest-pool-workers` is dropped, since none of the worker's tests
ever touched a workerd API. Two tsconfigs remain, because Node and Workers
genuinely disagree about `fetch` and `Request`. CI is one `ci.yml` covering the
whole repo, and it now bundles the worker (`wrangler deploy --dry-run`), which
the unit tests cannot do.

The install page's tool list is checked against the real registrations in a
test, so it can no longer go stale.

## 2026-07-27

### MCP 2025-11-25 conventions

- List tools declare an `outputSchema` for the `{ collection, next_href }`
  envelope, so clients can validate `structuredContent` and discover pagination
  without reading the description. Built with `z.looseObject` — a plain
  `z.object` compiles to `additionalProperties: false`, and since the client
  validates strictly, one undocumented field on `/me/feed/tracks` was enough to
  fail the call. Unit tests passed throughout; the live run caught it.
- Both servers advertise `title`, `description`, `websiteUrl`, an SVG icon, and
  `instructions` that tell the model to resolve pasted links first, that ids may
  be URNs, and how to page.
- Resource templates for `soundcloud://{tracks,users,playlists}/{id}`, so a
  client can attach a track as context without a tool call. The worker also
  gained the three `soundcloud://me/*` resources it never had.
- The install page has a favicon and Open Graph tags; the worker serves the mark
  at `/icon.svg`.
- Audited the rest of the spec and skipped it deliberately — logging, sampling
  and roots are deprecated, tasks are experimental, and nothing here needs
  elicitation. Reasons are in `PLAN.md`.

### API sync skill documented

- `README.md` advertises the maintenance workflow to human operators: the
  `/soundcloud-api-sync` skill, the standalone audit script, `verify.mjs`, and
  the two Atom feeds that are the only reliable notice of API changes.
- `CLAUDE.md` warns agents that green unit tests say nothing about the deployed
  worker, and sets rules for testing writes against a live account (reversible
  pairs only; `add_comment` has no delete counterpart).

## 2026-07-26

### Remote worker was returning errors for every tool call

- The global `fetch` was stored as a class property and invoked as
  `this.fetchImpl(...)`, so Cloudflare Workers rejected every request with
  "Illegal invocation". Every tool on the deployed server was affected. The test
  suite missed it because the tests always inject a stub `fetch`, so the default
  path was never exercised — 22/22 green against a server that could not answer
  a single call.
- `get_recently_played` ignored its `limit`. SoundCloud returns the last 25
  played tracks with no pagination regardless of what you ask for, so a
  one-track request came back with fourteen and 49KB of JSON. Now trimmed
  client-side in both servers.

### SoundCloud API sync skill

- New `soundcloud-api-sync` skill collecting every authoritative source —
  OpenAPI spec, GitHub release notes, SoundCloud's own `Agents.md` and agent
  skills, the `llm-context` reference — plus the rules that repeatedly cause
  bugs (OAuth not Bearer, URNs not numeric ids, single-use refresh tokens).
- `audit.mjs` diffs the live spec against the endpoints both clients call,
  method-aware, and lists release notes since a date. Current coverage is 32 of
  64 operations, with no endpoints called that the spec has dropped.
- `PLAN.md` records the full gap list, a ranked set of candidates, and a
  "synced through" date. Notable near-term wins: `sort=asc|desc` on user tracks
  (shipped upstream 2026-07-19) and `/users/{urn}/web-profiles`.

### Verified end to end

- Every tool exercised against the deployed worker through a real MCP client,
  including like/repost/follow round-trips and a create → append → remove →
  rename → delete playlist round-trip.

### Install page

- The worker serves an install page at its root instead of a bare 404.

## 2026-07-25

### Cloudflare Workers remote MCP server

- New `soundcloud-mcp-cloudflare/` package: a remote MCP server with OAuth 2.1
  PKCE, token state in a Durable Object, and an approval dialog gating dynamic
  client registration. Shares no code with the stdio server yet — `PLAN.md`
  covers the options for deduplicating them.

### Dead endpoints removed, URNs adopted

- Dropped tools backed by endpoints SoundCloud has retired from the public API,
  which now return 405: `/me/recommended/tracks` and the six messaging tools.
- Paths take SoundCloud URNs (`soundcloud:tracks:123`); numeric ids are
  normalized at the client boundary.
- Added the endpoints that did exist and were missing: `resolve`, an artist's
  uploads and likes, related artists, the follow feed, recently played, and
  track reposts.

## 2026-07-01

- Documented Claude Desktop setup.

## 2026-06-30

### MCP 2025-06-18 conventions

- Tools carry `title` and behavior annotations, return `structuredContent`
  alongside text, and emit `resource_link` blocks for permalinks, artwork, and
  audio.
- Tool registration decoupled from the stdio transport so a remote entrypoint
  could reuse it — which is what the Workers server later did.

### Working stdio server

- Reworked auth into a functioning stdio MCP server with token persistence and
  refresh.
- Added a `get_stream_url` tool and hardened playlist track ids: ids above
  int32 must be sent as URN strings or SoundCloud returns 422 with no useful
  message.
- Added Biome linting and Vitest tests; upgraded dependencies and dropped
  `dotenv` for Node's native env loading.

## 2025-01-26

- Initial OAuth spike: a local callback server and the first working token
  exchange.
