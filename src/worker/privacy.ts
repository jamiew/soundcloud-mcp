// The privacy page at `/privacy`. Keep it in step with what the worker stores:
// grant props in worker/handler.ts, KV keys, cookies, and sign_out.

const REPO_URL = "https://github.com/jamiew/soundcloud-mcp";

export function privacyPage(): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy · SoundCloud MCP</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto; padding: 3rem 1.25rem 5rem; max-width: 42rem;
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  h1 { font-size: 1.6rem; margin: 0 0 1rem; }
  h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .875em; }
</style>
</head>
<body>
<main>
  <h1>Privacy</h1>
  <p>
    This server connects your AI assistant to the SoundCloud API. The person who
    deployed it runs it. It is not affiliated with SoundCloud.
  </p>

  <h2>What it stores</h2>
  <ul>
    <li>
      When you connect, it stores your SoundCloud user ID, username, and profile URL
      name, and the SoundCloud access and refresh tokens for your account. They are
      encrypted and kept in Cloudflare Workers KV with the login for your AI client.
    </li>
    <li>
      It stores the name and redirect URLs your AI client registers, and login state
      that expires after 10 minutes.
    </li>
    <li>Your browser keeps a cookie for 30 days that remembers which AI clients you approved.</li>
  </ul>

  <h2>What it does not store</h2>
  <p>
    It does not store your searches, tool results, or SoundCloud content. Each request
    goes to SoundCloud, and the answer goes straight back to your AI client.
    Cloudflare keeps request logs and error messages for this server for a limited time.
  </p>

  <h2>Deleting your data</h2>
  <ul>
    <li>
      Ask your assistant to run <code>sign_out</code>. It asks SoundCloud to revoke this
      server's access and deletes all your stored tokens.
    </li>
    <li>Otherwise your stored tokens are deleted 30 days after you connect.</li>
    <li>
      If the operator removes your account from the allowlist, your tokens are deleted
      on your next request.
    </li>
  </ul>

  <h2>Other services</h2>
  <p>
    SoundCloud provides the data under its own
    <a href="https://soundcloud.com/pages/privacy">privacy policy</a>. Cloudflare hosts
    the server. Questions go to <a href="${REPO_URL}/issues">GitHub issues</a>.
  </p>
</main>
</body>
</html>`;
}
