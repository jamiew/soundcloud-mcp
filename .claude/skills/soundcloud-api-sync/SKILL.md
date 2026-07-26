---
name: soundcloud-api-sync
description: Refresh this repo's knowledge of the SoundCloud API from official sources — diff the live OpenAPI spec against the endpoints we call, read new API release notes, and update PLAN.md. Use when asked what changed in the SoundCloud API, whether an endpoint still exists, what features we could add, or to check for API announcements.
---

# SoundCloud API sync

SoundCloud ships API changes with no email list and no versioning. The GitHub
release notes are the only real changelog, and endpoints have been removed from
the public API without deprecation — they just start returning 405. This skill
re-derives what is true from the official sources.

## Run the audit first

```bash
node .claude/skills/soundcloud-api-sync/audit.mjs                  # latest 8 releases
node .claude/skills/soundcloud-api-sync/audit.mjs --since 2026-07-19
```

It fetches the live spec and prints three things:

- **NOT IMPLEMENTED** — spec operations no tool calls yet, method-aware
  (`POST /tracks` counts as missing even though we `GET /tracks`).
- **CALLED BUT NOT IN SPEC** — the dangerous direction. Anything listed here is
  a candidate for the silent 405 treatment; verify it live before trusting it.
- **RELEASES** — dated release-note headlines.

Pass `--since` with the date in PLAN.md's "SoundCloud API synced through" line
to see only what is new, then update that line when done.

## Authoritative sources, in order

| Source | URL | Use for |
|---|---|---|
| OpenAPI spec (YAML) | `https://raw.githubusercontent.com/soundcloud/api/master/openapi/api.yaml` | The contract. Check before adding any endpoint. |
| Release notes | <https://github.com/soundcloud/api/releases> | The changelog. Nothing else lists changes. |
| Spec commit history | <https://github.com/soundcloud/api/commits/master/openapi/api.yaml> | Diffs between releases; `chore: update OpenAPI spec` commits land ahead of some notes. |
| `Agents.md` | <https://github.com/soundcloud/api/blob/master/Agents.md> | SoundCloud's own agent integration rules. |
| Cursor skills | `.cursor/skills/` in `soundcloud/api` | Their auth/discovery/integration guidance. Mirrors our `CLAUDE.md` rules. |
| LLM context | <https://developers.soundcloud.com/docs/llm-context> | Rate limits, upload limits, quotas in one page. |
| API guide | <https://developers.soundcloud.com/docs/api/guide> | Prose explanations. |
| Issue tracker | <https://github.com/soundcloud/api/issues> | Known bugs; releases cite issue numbers. |

Two Atom feeds are worth watching, both usable without auth:

- `https://github.com/soundcloud/api/releases.atom`
- `https://github.com/soundcloud/api/commits/master/openapi/api.yaml.atom`

Announcements also go to [@SoundCloudDev on X](https://x.com/SoundCloudDev),
[Bluesky](https://bsky.app/profile/soundcloud.dev), and the
[Backstage blog](https://developers.soundcloud.com/blog). There is no RSS for
the blog and no developer newsletter.

## Rules that keep biting

These are settled facts, re-verified 2026-07-26. Do not re-litigate them from
memory — check the spec if something contradicts them.

- Two hosts: `api.soundcloud.com` for the API, `secure.soundcloud.com` for
  `/authorize` and `/oauth/token`. Legacy `api.soundcloud.com/oauth2/token` is
  deprecated.
- `Authorization: OAuth <token>`, never `Bearer`.
- URNs in paths (`soundcloud:tracks:123`). Numeric ids are deprecated.
- Refresh tokens are single-use; persist the rotated one or auth dies for good.
- Client-credentials tokens: 50 per 12h per app, 30 per hour per IP. Play-stream
  requests: 15,000 per 24h per `client_id`.
- No official SDK is maintained. The Ruby, Python, and JS repos are all
  archived-in-practice (last real commit 2019) and SoundCloud tells you to build
  a client from the spec. Do not copy patterns from them.

## After the audit

1. Report new endpoints and note which are worth exposing as tools.
2. If an endpoint we call vanished from the spec, verify it live before removing
   anything — the spec has lagged reality in both directions.
3. Update the coverage table and the "synced through" date in `PLAN.md`.
4. A tool change usually needs making in **both** servers (`src/` and
   `soundcloud-mcp-cloudflare/src/`); they do not share code.
