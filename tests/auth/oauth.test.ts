import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, generateOAuthState, generatePkcePair } from "../../src/auth/oauth";

const base64UrlOf = (input: string): string =>
  createHash("sha256").update(input).digest("base64url");

describe("generatePkcePair", () => {
  it("produces a verifier and S256 challenge that match", () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(codeChallenge).toBe(base64UrlOf(codeVerifier));
  });

  it("emits a different pair on every call", () => {
    const a = generatePkcePair();
    const b = generatePkcePair();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });

  it("uses unpadded base64url alphabet (RFC 7636)", () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("generateOAuthState", () => {
  it("emits non-empty base64url strings, never repeating", () => {
    const a = generateOAuthState();
    const b = generateOAuthState();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe("buildAuthorizeUrl", () => {
  it("composes the consumers /authorize URL with every required PKCE query param", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "client-1",
        redirectUri: "http://127.0.0.1:54321/oauth/callback",
        state: "STATE-1",
        codeChallenge: "CHAL-1",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:54321/oauth/callback");
    expect(url.searchParams.get("scope")).toBe("XboxLive.signin offline_access");
    expect(url.searchParams.get("state")).toBe("STATE-1");
    expect(url.searchParams.get("code_challenge")).toBe("CHAL-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_mode")).toBe("query");
  });

  it("appends prompt=select_account by default — matches the 'always show account picker' UX", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "c",
        redirectUri: "http://127.0.0.1:1/oauth/callback",
        state: "s",
        codeChallenge: "ch",
      }),
    );
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("omits prompt when explicitly opted out", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "c",
        redirectUri: "http://127.0.0.1:1/oauth/callback",
        state: "s",
        codeChallenge: "ch",
        promptSelectAccount: false,
      }),
    );
    expect(url.searchParams.get("prompt")).toBeNull();
  });
});
