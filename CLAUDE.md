# CLAUDE.md

Working notes for agents in this repo. See `PLAN.md` for status and the full
API audit.

## Layout

- `src/` — stdio MCP server, pnpm, Node 22+. `pnpm build` before testing;
  clients run the compiled `build/index.js`, not the TS.
- `soundcloud-mcp-cloudflare/` — remote MCP server on Cloudflare Workers, pnpm.
  Run its scripts from inside that directory.

The two do not share code yet — a change to a tool usually wants making in
**both**. `PLAN.md` has the options for deduplicating them.

Verify stdio changes against the live API with `pnpm build && node scripts/verify.mjs`,
which exercises every read tool plus a create/read/delete playlist round-trip
and cleans up after itself.

## SoundCloud API rules

Authoritative sources, in order: the OpenAPI spec at
<https://github.com/soundcloud/api> (`openapi/api.yaml`), SoundCloud's
`Agents.md` in that same repo, then <https://developers.soundcloud.com/docs/api/guide>.
Check the spec before adding an endpoint — several plausible-looking ones were
removed from the public API and now return 405 (see `PLAN.md`).

- **Two hosts.** `https://api.soundcloud.com` for the API,
  `https://secure.soundcloud.com` for `/authorize` and `/oauth/token`. The
  legacy `api.soundcloud.com/oauth2/token` is explicitly deprecated.
- **`Authorization: OAuth <token>`** — not `Bearer`. This fails silently-ish
  (401) if you copy a Spotify-shaped client.
- **URNs, not numeric ids.** Paths take `soundcloud:tracks:123`. Numeric ids
  still resolve today but are deprecated; normalize at the client boundary.
- **Refresh tokens are single-use.** Every refresh returns a new one. Persist it
  or the next refresh fails permanently and the user has to re-auth.
- **PKCE is mandatory** (OAuth 2.1). The verifier must survive the redirect —
  in the worker it lives in KV keyed by the OAuth state token.
- **Client-credentials tokens are rate limited hard**: 50 per 12h per app, 30
  per hour per IP. Cache them; never mint one per request.
- **Pagination is cursor-based.** Pass `linked_partitioning=true` and follow
  `next_href`, which is an absolute URL — fetch it as-is, do not re-base it onto
  the API root. Default page 50, max 200.
- **Playlist writes replace the whole tracklist** — there is no append endpoint.
  Read, concatenate, PUT. Track ids above int32 (`2147483647`) must be sent as
  URN strings or the API returns 422 with no useful message.
- **`access` is `playable` | `preview` | `blocked`.** Blocked tracks have no
  stream. `/tracks/{urn}/streams` returns time-limited URLs; the older
  `/stream` endpoint is deprecated.

## Testing against the live API

The stdio server has a working token at `~/.soundcloud-mcp/tokens.json`. The
quickest end-to-end check is to drive the built server over stdio with an MCP
client script — do that rather than curling the API by hand, since it exercises
the tool layer too. Put scratch scripts in `tmp/` (gitignored).

Never read `.env` directly. `pnpm start` and `pnpm run auth` load it natively via
`--env-file-if-exists`.

**Green unit tests do not mean the deployed worker works.** The tests inject a
stub `fetch`, so anything that only fails against the real runtime passes them —
that is exactly how a worker whose every tool call 500'd shipped with 22/22
green. If the worker is connected as an MCP server in your session, call its
tools directly; that is the only check that covers the deployed code path.
Otherwise `pnpm run deploy` from `soundcloud-mcp-cloudflare/` and confirm the
version id with `npx wrangler deployments list` before testing.

When testing writes against the live account, prefer reversible pairs and undo
them (like/unlike, follow/unfollow, create/delete playlist). `add_comment` has
no delete counterpart — comment only on the connected user's own tracks, and say
so afterwards. `next_page` takes any absolute API URL, which makes it a handy
escape hatch for trying an endpoint or query param we do not expose yet.

## Staying current with the API

Invoke the **`soundcloud-api-sync`** skill before adding an endpoint, when
something contradicts the rules above, or when asked what changed upstream. It
carries the authoritative source list; `PLAN.md` carries the coverage gap table
and a "synced through" date. Do not answer SoundCloud API questions from memory —
the spec has moved in both directions, and endpoints have been removed without
notice.

The official Ruby, Python, and JS SDKs are all unmaintained and out of sync with
the API. Do not copy patterns from them.

## Conventions

- Tools carry `title` + behavior annotations, return `structuredContent`
  alongside text, and emit `resource_link` blocks for permalinks, artwork, and
  audio. Keep that up for new tools.
- **`outputSchema` must use `z.looseObject`, never `z.object`.** A plain object
  compiles to `additionalProperties: false`, and the *client* validates the
  result strictly — so the first extra field SoundCloud adds becomes a protocol
  error the server never sees and no unit test catches. Describe the envelope
  (`collection`, `next_href`) and stop there; pinning entity fields buys nothing
  against an API that changes shape without notice. Tools that can return a bare
  array rather than a collection — `next_page` — get no `outputSchema` at all.
- Only declare `outputSchema` on tools that always return an object. If a tool
  can return a plain string, the SDK errors on the missing `structuredContent`.
- Error text reaching the model should be one short actionable sentence, never a
  raw API body.
- Biome, tabs in the worker / 2 spaces in `src/`. Run the project's `lint`,
  `type-check`, and `test` before finishing.
