# CLAUDE.md

Working notes for agents in this repo. See `PLAN.md` for status and the full
API audit.

## Layout

- `src/` — stdio MCP server, npm, Node 22+. `npm run build` before testing;
  clients run the compiled `build/index.js`, not the TS.
- `soundcloud-mcp-cloudflare/` — remote MCP server on Cloudflare Workers, pnpm.
  Run its scripts from inside that directory.

The two do not share code. A change to a tool usually wants making in both.

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

Never read `.env` directly. `npm start` and `npm run auth` load it natively via
`--env-file-if-exists`.

## Conventions

- Tools carry `title` + behavior annotations, return `structuredContent`
  alongside text, and emit `resource_link` blocks for permalinks, artwork, and
  audio. Keep that up for new tools.
- Error text reaching the model should be one short actionable sentence, never a
  raw API body.
- Biome, tabs in the worker / 2 spaces in `src/`. Run the project's `lint`,
  `type-check`, and `test` before finishing.
