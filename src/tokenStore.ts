import fs from "fs";
import path from "path";
import { TOKEN_FILE } from "./config.js";
import { OAuthToken } from "./types.js";
import { debug } from "./log.js";

// Persisted token shape: the raw OAuth response plus when we obtained it,
// so we can tell whether the access token is still valid.
export interface StoredToken extends OAuthToken {
  obtained_at: number; // unix seconds
}

export function loadTokens(): StoredToken | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")) as StoredToken;
  } catch (error) {
    debug("Failed to read token file:", error);
    return null;
  }
}

export function saveTokens(token: OAuthToken): StoredToken {
  const stored: StoredToken = { ...token, obtained_at: Math.floor(Date.now() / 1000) };
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(stored, null, 2), { mode: 0o600 });
  fs.chmodSync(TOKEN_FILE, 0o600);
  return stored;
}

export function clearTokens(): void {
  try {
    fs.rmSync(TOKEN_FILE, { force: true });
  } catch (error) {
    debug("Failed to clear token file:", error);
  }
}

// Refresh a bit early; SoundCloud refresh tokens are single-use.
export function isExpired(token: StoredToken, skewSeconds = 300): boolean {
  const expiresAt = token.obtained_at + (token.expires_in ?? 3600);
  return Date.now() / 1000 >= expiresAt - skewSeconds;
}
