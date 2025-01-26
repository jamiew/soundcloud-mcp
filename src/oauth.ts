import crypto from "crypto";
import { OAuthConfig, OAuthToken, PKCEChallenge } from "./types.js";

export class SoundCloudOAuth {
  private config: OAuthConfig;
  private baseUrl = "https://secure.soundcloud.com";

  constructor(config: OAuthConfig) {
    this.config = config;
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
}
