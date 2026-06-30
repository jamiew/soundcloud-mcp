import os from "os";
import path from "path";

// SoundCloud uses two hosts: secure.* for the OAuth token endpoints,
// api.* for everything else.
export const API_BASE = "https://api.soundcloud.com";
export const AUTH_BASE = "https://secure.soundcloud.com";

export const CLIENT_ID = (process.env.SOUNDCLOUD_CLIENT_ID ?? "").trim();
export const CLIENT_SECRET = (process.env.SOUNDCLOUD_CLIENT_SECRET ?? "").trim();
export const REDIRECT_URI = (
  process.env.SOUNDCLOUD_REDIRECT_URI ?? "http://localhost:8888/callback"
).trim();

// Where user OAuth tokens are persisted between runs.
const defaultTokenFile = path.join(os.homedir(), ".soundcloud-mcp", "tokens.json");
export const TOKEN_FILE = (
  process.env.SOUNDCLOUD_TOKEN_FILE ?? defaultTokenFile
).replace(/^~(?=$|\/)/, os.homedir());

// Verbose logging to stderr (never stdout — that's the MCP transport).
export const DEBUG = process.env.MCP_DEBUG === "true";
