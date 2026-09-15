# Agent guide

See `README.md` for setup and `PLAN.md` for open work and the dated API audit.

## Layout

One pnpm package supports Node 22.18+ or 24.11+ LTS. Use `package.json` for exact
engine and dependency versions.

- Shared: `src/{client,tools,types,server,icon}.ts`. Keep this code runtime-neutral:
  no Node or Workers APIs. Put tool changes here so both servers receive them.
- Local: `src/index.ts` and `src/stdio/`. Build first; clients run
  `build/index.js`, not TypeScript.
- Remote: `src/worker.ts` and `src/worker/`.

Node and Workers need separate typechecks because their `fetch` and `Request`
types differ. `pnpm typecheck` runs both. Keep worker paths excluded from
`tsconfig.build.json`: `exclude` replaces the base value rather than extending it.
Relative imports need `.js` extensions for NodeNext; Wrangler resolves them to TS.
Keep global `fetch` bound to `globalThis` for Workers.

## API rules

Use sources in this order: the
[OpenAPI spec](https://github.com/soundcloud/api) (`openapi/api.yaml`),
SoundCloud's `Agents.md` in that repo, then the
[API guide](https://developers.soundcloud.com/docs/api/guide).

Use the `soundcloud-api-sync` skill before adding endpoints, when these rules
conflict with observed behavior, or when asked about upstream changes. Check the
spec, not memory: endpoints have disappeared without notice and return 405.
Update `PLAN.md` coverage and its synced-through date after auditing. Do not copy
patterns from the unmaintained official Ruby, Python, or JavaScript SDKs.

- API host: `https://api.soundcloud.com`. OAuth `/authorize` and `/oauth/token`:
  `https://secure.soundcloud.com`. Legacy `api.soundcloud.com/oauth2/token` is
  deprecated.
- Send `Authorization: OAuth <token>`, not `Bearer`.
- Normalize numeric IDs to URNs at the client boundary. Numeric path IDs are
  deprecated.
- Refresh tokens are single-use. Persist each replacement or the user must
  authorize again. Only one component may refresh a token.
- The worker's sole refresh owner is `tokenExchangeCallback` in `worker.ts`.
  Write rotated tokens back to the OAuth grant so future sessions receive them.
  Never refresh or own token state in the per-session Durable Object.
- OAuth 2.1 requires PKCE. Preserve the verifier across redirects; the worker
  stores it in KV under the OAuth state token.
- Cache client-credentials tokens: limits are 50 per 12 hours per app and 30 per
  hour per IP. Never mint one per request.
- Pagination uses `linked_partitioning=true` and absolute `next_href` URLs.
  Fetch those URLs as supplied, without rebasing. Default page size is 50;
  maximum is 200.
- Playlist writes replace the entire tracklist. To append, read, concatenate,
  then PUT. Send track IDs above int32 (`2147483647`) as URN strings to avoid 422.
- Track `access` is `playable`, `preview`, or `blocked`. Blocked tracks have no
  stream. `/tracks/{urn}/streams` returns expiring URLs; `/stream` is deprecated.

## Verification and safety

Never read `.env` directly. `pnpm start` and `pnpm run auth` load it through
`--env-file-if-exists`. Local tokens default to `~/.soundcloud-mcp/tokens.json`;
use them through the server, not by inspecting credentials.

- Run `pnpm check` before finishing: lint, Markdown lint, both typechecks, tests.
- Run `pnpm verify` for live stdio checks. It builds the server, exercises read
  tools, resources and templates, and creates, reads, then deletes a temporary
  playlist. It does not cover every tool.
- For extra checks, drive the built server through an MCP client rather than
  curling the API. Put scratch scripts in gitignored `tmp/`.
- Run `pnpm exec wrangler deploy --dry-run` to check worker bundling without
  deploying. Node tests with stubbed `fetch` do not verify workerd or deployment.
  If the deployed worker is connected as an MCP server, call its tools directly.
- Pushes to `main` deploy when CI deployment is enabled. Match
  `pnpm exec wrangler deployments list` version IDs against CI logs before
  claiming a change is live. Reconnect clients to refresh cached `tools/list`.
- Undo live writes with reversible pairs: like/unlike, follow/unfollow,
  create/delete playlist. `add_comment` has no delete counterpart; comment only
  on the connected user's own tracks and report it afterward.
- `next_page` can try absolute API URLs for unexposed endpoints or parameters.
  Use only SoundCloud API URLs: requests carry the user's token.

## Conventions

- Use Biome and tabs, as configured in `biome.json`.
- Give tools a `title` and behavior annotations. Return `structuredContent`
  alongside text where applicable, and `resource_link` blocks for permalinks,
  artwork, and audio.
- Use `z.looseObject`, never `z.object`, for `outputSchema`. Strict schemas
  reject undocumented upstream fields at the client. Describe only the envelope
  (`collection`, `next_href`), not entity fields.
- Declare `outputSchema` only when every result is an object. Omit it for tools
  that can return strings or bare arrays, including `next_page`; otherwise the
  SDK can reject missing `structuredContent`.
- Return one short, actionable error sentence to the model, never a raw API body.
