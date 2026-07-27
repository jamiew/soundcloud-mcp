# Changelog

## 2026-07-27

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
