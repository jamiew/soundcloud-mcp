// The public page at `/`. Self-contained: no external CSS, fonts, or scripts.

const REPO_URL = "https://github.com/jamiew/soundcloud-mcp";

// Hand-maintained, and checked against the real registrations in landing.test.ts
// so it cannot drift.
export const TOOL_GROUPS: [string, string[]][] = [
	[
		"Discovery",
		[
			"search_tracks",
			"search_playlists",
			"search_users",
			"resolve_url",
			"get_track",
			"get_user",
			"get_user_tracks",
			"get_user_playlists",
			"get_user_likes",
			"get_playlist",
			"get_playlist_tracks",
			"get_related_tracks",
			"get_related_artists",
			"get_stream_url",
			"get_comments",
			"next_page",
		],
	],
	[
		"Your library",
		[
			"get_profile",
			"get_my_likes",
			"get_my_playlists",
			"get_my_tracks",
			"get_my_followings",
			"get_feed",
			"get_recently_played",
		],
	],
	[
		"Social",
		[
			"like_track",
			"unlike_track",
			"repost_track",
			"unrepost_track",
			"follow_user",
			"unfollow_user",
			"add_comment",
		],
	],
	[
		"Playlists",
		[
			"create_playlist",
			"update_playlist",
			"add_tracks_to_playlist",
			"remove_track_from_playlist",
			"delete_playlist",
		],
	],
];

const TOOL_COUNT = TOOL_GROUPS.reduce((n, [, list]) => n + list.length, 0);

const DESCRIPTION =
	"A remote MCP server giving AI assistants access to SoundCloud search, your library, and playlists.";

const escapeHtml = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Renders the install page. `origin` comes from the request, so it is correct
 * on workers.dev, a custom domain, or localhost during `wrangler dev`. */
export function landingPage(origin: string): string {
	const mcpUrl = `${origin}/mcp`;
	const tools = TOOL_GROUPS.map(
		([name, list]) => `<section class="group">
        <h3>${name} <span class="count">${list.length}</span></h3>
        <ul>${list.map((t) => `<li><code>${t}</code></li>`).join("")}</ul>
      </section>`
	).join("");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SoundCloud MCP</title>
<meta name="description" content="${DESCRIPTION}">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:title" content="SoundCloud MCP">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:url" content="${escapeHtml(origin)}">
<meta property="og:image" content="${escapeHtml(origin)}/icon.svg">
<meta name="twitter:card" content="summary">
<style>
  :root {
    --bg: #fff; --fg: #16161a; --muted: #5f6570; --line: #e5e7eb;
    --code-bg: #f6f7f9; --accent: #f50; --link: #0b57d0;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115; --fg: #e8eaed; --muted: #9aa1ab; --line: #262a33;
      --code-bg: #171a21; --accent: #ff5500; --link: #7cb3ff;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 3rem 1.25rem 5rem; background: var(--bg); color: var(--fg);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { font-size: 1.9rem; margin: 0 0 .35rem; letter-spacing: -.02em; }
  h1 .dot { color: var(--accent); }
  h2 { font-size: 1.05rem; margin: 2.5rem 0 .75rem; letter-spacing: -.01em; }
  h3 { font-size: .85rem; margin: 0 0 .5rem; text-transform: uppercase;
       letter-spacing: .06em; color: var(--muted); font-weight: 600; }
  p { margin: 0 0 1rem; }
  .lede { color: var(--muted); font-size: 1.05rem; margin-bottom: 2rem; }
  a { color: var(--link); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .875em; }
  pre {
    background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px;
    padding: .8rem 1rem; overflow-x: auto; margin: 0 0 1rem;
  }
  pre code { font-size: .8125rem; white-space: pre; }
  .url {
    display: inline-block; background: var(--code-bg); border: 1px solid var(--line);
    border-radius: 6px; padding: .35rem .6rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .875rem; word-break: break-all;
  }
  .groups { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
  .group ul { list-style: none; margin: 0; padding: 0; }
  .group li { padding: .1rem 0; }
  .group li code { color: var(--fg); }
  .count { color: var(--muted); font-weight: 400; }
  .note {
    border-left: 3px solid var(--accent); padding: .1rem 0 .1rem .9rem;
    color: var(--muted); margin: 1.25rem 0;
  }
  footer {
    margin-top: 3.5rem; padding-top: 1.25rem; border-top: 1px solid var(--line);
    color: var(--muted); font-size: .875rem;
  }
</style>
</head>
<body>
<main>
  <h1>SoundCloud MCP<span class="dot">.</span></h1>
  <p class="lede">
    A remote <a href="https://modelcontextprotocol.io">MCP</a> server that gives an AI assistant
    access to SoundCloud — search and discovery, your likes and playlists, follows and reposts.
    ${TOOL_COUNT} tools, each verified against the live API.
  </p>

  <h2>Endpoint</h2>
  <p><span class="url">${escapeHtml(mcpUrl)}</span></p>

  <h2>Add to Claude Code</h2>
  <pre><code>claude mcp add --transport http soundcloud ${escapeHtml(mcpUrl)}</code></pre>

  <h2>Add to Claude web or desktop</h2>
  <p>
    Settings → Connectors → Add custom connector, and paste the endpoint URL above.
    The first tool call opens SoundCloud's login in your browser.
  </p>

  <div class="note">
    This is someone's personal server. Access is limited to an allowlist of SoundCloud
    accounts, so signing in will not grant you access —
    <a href="${REPO_URL}">run your own</a> instead. It is one <code>wrangler deploy</code>.
  </div>

  <h2>Tools</h2>
  <div class="groups">${tools}</div>

  <footer>
    <a href="${REPO_URL}">Source on GitHub</a> ·
    <a href="${REPO_URL}/blob/main/CHANGELOG.md">Changelog</a> ·
    Unofficial, not affiliated with SoundCloud ·
    Used within the
    <a href="https://developers.soundcloud.com/docs/api/terms-of-use">API Terms of Use</a>
  </footer>
</main>
</body>
</html>`;
}
