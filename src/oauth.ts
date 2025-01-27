import crypto from "crypto";
import http from "http";
import { URL } from "url";
import { OAuthConfig, OAuthToken, PKCEChallenge } from "./types.js";

export class SoundCloudOAuth {
  private config: OAuthConfig;
  private baseUrl = "https://secure.soundcloud.com";

  private server?: http.Server;
  private isClosing = false;

  constructor(config: OAuthConfig) {
    this.config = config;
    this.startLocalServer();
  }

  /**
   * Extracts port from redirect URI
   */
  private getRedirectPort(): number {
    try {
      const url = new URL(this.config.redirectUri);
      return parseInt(url.port) || 80;
    } catch (error) {
      console.error("Invalid redirect URI:", error);
      return 3000; // Default fallback
    }
  }

  /**
   * Starts local HTTP server for OAuth callback
   */
  private startLocalServer() {
    const port = this.getRedirectPort();

    this.server = http.createServer((req, res) => {
      // Set CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      // Only handle GET requests to the callback path
      const url = new URL(req.url || "", `http://localhost:${port}`);
      const callbackPath = new URL(this.config.redirectUri).pathname;

      if (req.method === "GET" && url.pathname === callbackPath) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h1>Authorization successful!</h1><p>You can close this window now.</p></body></html>"
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.server.listen(port, () => {
      console.log(`OAuth callback server listening on port ${port}`);
    });

    this.server.on("error", (error) => {
      console.error("OAuth server error:", error);
    });
  }

  /**
   * Generates PKCE challenge for OAuth flow
   */
  async generatePKCEChallenge(): Promise<PKCEChallenge> {
    // Generate code verifier (random string between 43-128 chars)
    const codeVerifier = crypto
      .randomBytes(32)
      .toString("base64")
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 128);

    // Generate code challenge (SHA256 hash of verifier, base64url encoded)
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    // Generate random state for CSRF protection
    const state = crypto.randomBytes(16).toString("hex");

    return {
      codeVerifier,
      codeChallenge,
      state,
    };
  }

  /**
   * Constructs the authorization URL for the OAuth flow
   */
  getAuthorizationUrl(pkce: PKCEChallenge): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      code_challenge: pkce.codeChallenge,
      code_challenge_method: "S256",
      state: pkce.state,
    });

    return `${this.baseUrl}/authorize?${params.toString()}`;
  }

  /**
   * Exchanges an authorization code for access and refresh tokens
   */
  async exchangeCode(code: string, codeVerifier: string): Promise<OAuthToken> {
    console.log("Exchanging authorization code for tokens...");
    const startTime = Date.now();

    const params = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      code_verifier: codeVerifier,
      code: code,
    });

    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json; charset=utf-8",
      },
      body: params.toString(),
    });

    const endTime = Date.now();
    console.log(`Token exchange completed in ${endTime - startTime}ms`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Token exchange failed: ${error.error || error.message}`);
    }

    return response.json();
  }

  /**
   * Gets an access token using client credentials flow
   */
  async getClientCredentialsToken(): Promise<OAuthToken> {
    console.log("Getting client credentials token...");
    const startTime = Date.now();

    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");

    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json; charset=utf-8",
        Authorization: `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials",
    });

    const endTime = Date.now();
    console.log(
      `Client credentials flow completed in ${endTime - startTime}ms`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        `Client credentials flow failed: ${error.error || error.message}`
      );
    }

    return response.json();
  }

  /**
   * Refreshes an access token using a refresh token
   */
  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    console.log("Refreshing access token...");
    const startTime = Date.now();

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
    });

    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json; charset=utf-8",
      },
      body: params.toString(),
    });

    const endTime = Date.now();
    console.log(`Token refresh completed in ${endTime - startTime}ms`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Token refresh failed: ${error.error || error.message}`);
    }

    return response.json();
  }

  /**
   * Signs out a user by invalidating their access token
   */
  async signOut(accessToken: string): Promise<void> {
    console.log("Signing out user...");
    const startTime = Date.now();

    const response = await fetch(`${this.baseUrl}/sign-out`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json; charset=utf-8",
      },
      body: JSON.stringify({ access_token: accessToken }),
    });

    const endTime = Date.now();
    console.log(`Sign out completed in ${endTime - startTime}ms`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Sign out failed: ${error.error || error.message}`);
    }
  }

  /**
   * Closes the OAuth server and cleans up resources
   */
  async close(): Promise<void> {
    if (!this.server || this.isClosing) return;

    this.isClosing = true;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          console.error("Error closing OAuth server:", err);
          reject(err);
        } else {
          console.log("OAuth server closed successfully");
          this.server = undefined;
          this.isClosing = false;
          resolve();
        }
      });
    });
  }
}
