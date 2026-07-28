import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import type { OAuthToken, PKCEChallenge } from "../types.js";
import { API_BASE, AUTH_BASE, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } from "./config.js";
import { debug, logError } from "./log.js";
import { isExpired, loadTokens, type StoredToken, saveTokens } from "./tokenStore.js";

export class OAuthError extends Error {}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePKCEChallenge(): PKCEChallenge {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  const state = crypto.randomBytes(16).toString("hex");
  return { codeVerifier, codeChallenge, state };
}

export function getAuthorizationUrl(pkce: PKCEChallenge): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    code_challenge: pkce.codeChallenge,
    code_challenge_method: "S256",
    state: pkce.state,
  });
  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

async function tokenRequest(
  body: URLSearchParams,
  extraHeaders: Record<string, string> = {}
): Promise<OAuthToken> {
  const response = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json; charset=utf-8",
      ...extraHeaders,
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new OAuthError(`Token request failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json() as Promise<OAuthToken>;
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<StoredToken> {
  const token = await tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      code,
    })
  );
  return saveTokens(token);
}

export async function getClientCredentialsToken(): Promise<OAuthToken> {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  return tokenRequest(new URLSearchParams({ grant_type: "client_credentials" }), {
    Authorization: `Basic ${credentials}`,
  });
}

export async function refreshToken(refresh_token: string): Promise<StoredToken> {
  const token = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token,
    })
  );
  return saveTokens(token);
}

export async function signOut(accessToken: string): Promise<void> {
  const response = await fetch(`${AUTH_BASE}/sign-out`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json; charset=utf-8" },
    body: JSON.stringify({ access_token: accessToken }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new OAuthError(`Sign out failed (${response.status}): ${text.slice(0, 300)}`);
  }
}

// Returns a valid USER access token, refreshing if it's near expiry.
// Throws if the user hasn't logged in yet.
export async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) {
    throw new OAuthError(
      "Not authenticated. Run `pnpm run auth` (or the connect-soundcloud tool) to log in."
    );
  }
  if (tokens.access_token && !isExpired(tokens)) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) {
    throw new OAuthError("Access token expired and no refresh token. Run `pnpm run auth` to log in again.");
  }
  debug("Access token expired; refreshing");
  const refreshed = await refreshToken(tokens.refresh_token);
  return refreshed.access_token;
}

export function hasUserToken(): boolean {
  return loadTokens() !== null;
}

// Client-credentials tokens (public data) have no refresh token, so we just
// cache one in memory and re-fetch when it nears expiry.
let cachedClientToken: { access_token: string; obtained_at: number; expires_in: number } | null = null;

export async function getCachedClientCredentialsToken(): Promise<string> {
  const now = Date.now() / 1000;
  if (cachedClientToken && now < cachedClientToken.obtained_at + cachedClientToken.expires_in - 60) {
    return cachedClientToken.access_token;
  }
  const token = await getClientCredentialsToken();
  cachedClientToken = {
    access_token: token.access_token,
    obtained_at: now,
    expires_in: token.expires_in ?? 3600,
  };
  return cachedClientToken.access_token;
}

// Unified token provider for the API client: a logged-in user token when
// available (library + writes), otherwise client-credentials for public calls.
export async function getApiToken(): Promise<string> {
  if (hasUserToken()) return getValidAccessToken();
  return getCachedClientCredentialsToken();
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch (error) {
    debug("Could not open browser automatically:", error);
  }
}

export interface LoginResult {
  token: StoredToken;
}

// Runs the full Authorization Code + PKCE flow: spins up a one-shot local
// server on the redirect URI's port, opens the browser, captures the callback
// code automatically, exchanges it for tokens, and persists them.
export function loginWithBrowser(
  options: { openBrowser?: boolean; timeoutMs?: number } = {}
): Promise<LoginResult> {
  const { openBrowser: shouldOpen = true, timeoutMs = 300_000 } = options;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return Promise.reject(
      new OAuthError("Set SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET in .env first.")
    );
  }

  const pkce = generatePKCEChallenge();
  const authUrl = getAuthorizationUrl(pkce);
  const redirect = new URL(REDIRECT_URI);
  const port = parseInt(redirect.port, 10) || (redirect.protocol === "https:" ? 443 : 80);

  return new Promise<LoginResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      fn();
    };

    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url || "/", `http://localhost:${port}`);
      if (reqUrl.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }

      const send = (status: number, message: string) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<html><body style="font-family:system-ui;text-align:center;padding-top:80px"><h1>${message}</h1><p>You can close this tab and return to your terminal.</p></body></html>`
        );
      };

      const error = reqUrl.searchParams.get("error");
      const code = reqUrl.searchParams.get("code");
      const state = reqUrl.searchParams.get("state");

      if (error) {
        send(400, "SoundCloud login failed");
        finish(() => reject(new OAuthError(reqUrl.searchParams.get("error_description") || error)));
      } else if (state !== pkce.state) {
        send(400, "Invalid state");
        finish(() => reject(new OAuthError("OAuth state mismatch (possible CSRF).")));
      } else if (!code) {
        send(400, "Missing authorization code");
        finish(() => reject(new OAuthError("No authorization code in callback.")));
      } else {
        try {
          const token = await exchangeCode(code, pkce.codeVerifier);
          send(200, "SoundCloud connected!");
          finish(() => resolve({ token }));
        } catch (err) {
          send(500, "Token exchange failed");
          finish(() => reject(err instanceof Error ? err : new OAuthError(String(err))));
        }
      }
    });

    server.on("error", (err) => finish(() => reject(err)));

    const timer = setTimeout(
      () => finish(() => reject(new OAuthError("Timed out waiting for SoundCloud callback."))),
      timeoutMs
    );

    server.listen(port, () => {
      logError(`Waiting for SoundCloud OAuth callback on ${REDIRECT_URI}`);
      logError(`Authorize URL:\n${authUrl}\n`);
      if (shouldOpen) openBrowser(authUrl);
    });
  });
}

export { API_BASE };
