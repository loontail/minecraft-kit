import { describe, expect, it } from "vitest";
import {
  exchangeAuthorizationCode,
  refreshMicrosoftToken,
  startDeviceCode,
} from "../../src/auth/microsoft";
import { isErrorCode } from "../../src/core/errors";
import { FakeHttpClient } from "../helpers/fake-http";

const DEVICE_CODE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

describe("startDeviceCode", () => {
  it("parses the success body into prompt + state", async () => {
    const http = new FakeHttpClient().on(DEVICE_CODE_URL, {
      body: JSON.stringify({
        device_code: "DEV1",
        user_code: "ABCD-EFGH",
        verification_uri: "https://microsoft.com/link",
        message: "go enter the code",
        expires_in: 900,
        interval: 5,
      }),
    });
    const { prompt, state } = await startDeviceCode({ http, clientId: "client-1" });
    expect(prompt.userCode).toBe("ABCD-EFGH");
    expect(prompt.verificationUri).toBe("https://microsoft.com/link");
    expect(state.deviceCode).toBe("DEV1");
    expect(state.clientId).toBe("client-1");
    expect(state.expiresAt).toBeGreaterThan(Date.now());
  });

  it("turns a 400/unauthorized_client into a helpful AUTH_DEVICE_CODE_FAILED error", async () => {
    const http = new FakeHttpClient().on(DEVICE_CODE_URL, {
      status: 400,
      body: JSON.stringify({
        error: "unauthorized_client",
        error_description: "AADSTS7000218: app must allow public flows",
      }),
    });
    try {
      await startDeviceCode({ http, clientId: "client-1" });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_DEVICE_CODE_FAILED")).toBe(true);
      const err = error as Error;
      expect(err.message).toMatch(/Allow public client flows/i);
    }
  });
});

describe("refreshMicrosoftToken", () => {
  it("returns a fresh access token and rotates the refresh token", async () => {
    const http = new FakeHttpClient().on(TOKEN_URL, {
      body: JSON.stringify({
        token_type: "Bearer",
        scope: "XboxLive.signin offline_access",
        expires_in: 3600,
        access_token: "AT2",
        refresh_token: "RT2",
      }),
    });
    const token = await refreshMicrosoftToken({ http, refreshToken: "RT1", clientId: "c" });
    expect(token).toEqual({ accessToken: "AT2", refreshToken: "RT2", expiresIn: 3600 });
  });

  it("keeps the old refresh token when the server omits a new one", async () => {
    const http = new FakeHttpClient().on(TOKEN_URL, {
      body: JSON.stringify({
        token_type: "Bearer",
        scope: "X",
        expires_in: 3600,
        access_token: "AT2",
      }),
    });
    const token = await refreshMicrosoftToken({ http, refreshToken: "RT-OLD", clientId: "c" });
    expect(token.refreshToken).toBe("RT-OLD");
  });

  it("throws AUTH_REFRESH_FAILED on invalid_grant", async () => {
    const http = new FakeHttpClient().on(TOKEN_URL, {
      status: 400,
      body: JSON.stringify({
        error: "invalid_grant",
        error_description: "AADSTS70008: refresh token expired",
      }),
    });
    try {
      await refreshMicrosoftToken({ http, refreshToken: "RT", clientId: "c" });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_REFRESH_FAILED")).toBe(true);
    }
  });
});

describe("exchangeAuthorizationCode", () => {
  it("trades the one-shot code for a Microsoft access + refresh token", async () => {
    const http = new FakeHttpClient().on(TOKEN_URL, {
      body: JSON.stringify({
        token_type: "Bearer",
        scope: "XboxLive.signin offline_access",
        expires_in: 3600,
        access_token: "MS-AT",
        refresh_token: "MS-RT",
      }),
    });
    const token = await exchangeAuthorizationCode({
      http,
      code: "CODE-1",
      codeVerifier: "VERIFIER-1",
      redirectUri: "http://127.0.0.1:54321/oauth/callback",
      clientId: "client-1",
    });
    expect(token).toEqual({ accessToken: "MS-AT", refreshToken: "MS-RT", expiresIn: 3600 });

    // Verify the request body shape — must be url-encoded `authorization_code` grant.
    const lastRequest = http.requests[http.requests.length - 1];
    const body = lastRequest?.options?.body as string;
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=CODE-1");
    expect(body).toContain("code_verifier=VERIFIER-1");
    expect(body).toContain("client_id=client-1");
  });

  it("throws AUTH_AUTHORIZATION_CODE_FAILED on invalid_grant", async () => {
    const http = new FakeHttpClient().on(TOKEN_URL, {
      status: 400,
      body: JSON.stringify({
        error: "invalid_grant",
        error_description: "code was already redeemed",
      }),
    });
    try {
      await exchangeAuthorizationCode({
        http,
        code: "stale",
        codeVerifier: "v",
        redirectUri: "http://127.0.0.1:1/oauth/callback",
        clientId: "c",
      });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_AUTHORIZATION_CODE_FAILED")).toBe(true);
    }
  });

  it("throws AUTH_AUTHORIZATION_CODE_FAILED when Microsoft omits a refresh token", async () => {
    const http = new FakeHttpClient().on(TOKEN_URL, {
      body: JSON.stringify({
        token_type: "Bearer",
        scope: "X",
        expires_in: 3600,
        access_token: "AT",
        // refresh_token deliberately missing
      }),
    });
    try {
      await exchangeAuthorizationCode({
        http,
        code: "C",
        codeVerifier: "V",
        redirectUri: "http://127.0.0.1:1/oauth/callback",
        clientId: "c",
      });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_AUTHORIZATION_CODE_FAILED")).toBe(true);
    }
  });
});
