import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOKEN_FILE } from "./config.js";
import { clearTokens, isExpired, loadTokens, type StoredToken, saveTokens } from "./tokenStore.js";

const sample = {
  access_token: "acc",
  refresh_token: "ref",
  expires_in: 3600,
  scope: "*",
  token_type: "bearer",
};

describe("isExpired", () => {
  const nowSec = Math.floor(Date.now() / 1000);

  it("treats a fresh token as not expired", () => {
    const token: StoredToken = { ...sample, obtained_at: nowSec };
    expect(isExpired(token)).toBe(false);
  });

  it("treats an old token past its lifetime as expired", () => {
    const token: StoredToken = { ...sample, obtained_at: nowSec - 7200 };
    expect(isExpired(token)).toBe(true);
  });

  it("treats a token expiring within the default skew window as expired", () => {
    const token: StoredToken = { ...sample, expires_in: 200, obtained_at: nowSec };
    expect(isExpired(token)).toBe(true);
  });

  it("falls back to a 3600s lifetime when expires_in is undefined", () => {
    const token = { ...sample, obtained_at: nowSec } as StoredToken;
    delete (token as unknown as Record<string, unknown>).expires_in;
    expect(isExpired(token)).toBe(false);
  });

  it("respects a custom skewSeconds", () => {
    const token: StoredToken = { ...sample, obtained_at: nowSec };
    expect(isExpired(token, 4000)).toBe(true);
  });
});

describe("saveTokens / loadTokens / clearTokens", () => {
  beforeEach(() => clearTokens());
  afterEach(() => clearTokens());

  it("round-trips a token through save and load", () => {
    const stored = saveTokens(sample);
    expect(typeof stored.obtained_at).toBe("number");
    expect(stored.access_token).toBe(sample.access_token);

    const loaded = loadTokens();
    expect(loaded?.access_token).toBe(sample.access_token);
    expect(loaded?.refresh_token).toBe(sample.refresh_token);
  });

  it("writes the token file with 0o600 permissions", () => {
    saveTokens(sample);
    expect(fs.statSync(TOKEN_FILE).mode & 0o777).toBe(0o600);
  });

  it("removes the file on clearTokens", () => {
    saveTokens(sample);
    clearTokens();
    expect(loadTokens()).toBeNull();
    expect(fs.existsSync(TOKEN_FILE)).toBe(false);
  });

  it("returns null when the file is absent", () => {
    expect(loadTokens()).toBeNull();
  });

  it("returns null when the file contains corrupt JSON", () => {
    fs.writeFileSync(TOKEN_FILE, "{ not json", "utf8");
    expect(loadTokens()).toBeNull();
  });
});
