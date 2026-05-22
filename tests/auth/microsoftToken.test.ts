import { describe, expect, it } from "vitest";
import { asAzureClientId } from "../../src/auth/index";
import { exchangeAuthorizationCode, refreshMicrosoftToken } from "../../src/auth/microsoftToken";
import { isErrorCode } from "../../src/core/errors";
import type { AzureClientId } from "../../src/types/auth";
import { FakeHttpClient } from "../helpers/fake-http";

const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const CLIENT_ID_A = asAzureClientId("00000000-0000-0000-0000-000000000001");
const CLIENT_ID_B = asAzureClientId("11111111-1111-1111-1111-111111111111");

const assertAuthorizationCodeGrantBody = (
  http: FakeHttpClient,
  expected: {
    readonly code: string;
    readonly codeVerifier: string;
    readonly clientId: AzureClientId;
  },
): void => {
  const lastRequest = http.requests[http.requests.length - 1];
  const body = lastRequest?.options?.body as string;
  expect(body).toContain("grant_type=authorization_code");
  expect(body).toContain(`code=${expected.code}`);
  expect(body).toContain(`code_verifier=${expected.codeVerifier}`);
  expect(body).toContain(`client_id=${expected.clientId}`);
};

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
    const token = await refreshMicrosoftToken({ http, refreshToken: "RT1", clientId: CLIENT_ID_A });
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
    const token = await refreshMicrosoftToken({
      http,
      refreshToken: "RT-OLD",
      clientId: CLIENT_ID_A,
    });
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
      await refreshMicrosoftToken({ http, refreshToken: "RT", clientId: CLIENT_ID_A });
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
      clientId: CLIENT_ID_B,
    });
    expect(token).toEqual({ accessToken: "MS-AT", refreshToken: "MS-RT", expiresIn: 3600 });

    assertAuthorizationCodeGrantBody(http, {
      code: "CODE-1",
      codeVerifier: "VERIFIER-1",
      clientId: CLIENT_ID_B,
    });
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
        clientId: CLIENT_ID_A,
      });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_AUTHORIZATION_CODE_FAILED")).toBe(true);
    }
  });

  it("throws AUTH_AUTHORIZATION_CODE_FAILED when Microsoft omits a refresh token", async () => {
    const refreshTokenDeliberatelyMissing = {
      token_type: "Bearer",
      scope: "X",
      expires_in: 3600,
      access_token: "AT",
    };
    const http = new FakeHttpClient().on(TOKEN_URL, {
      body: JSON.stringify(refreshTokenDeliberatelyMissing),
    });
    try {
      await exchangeAuthorizationCode({
        http,
        code: "C",
        codeVerifier: "V",
        redirectUri: "http://127.0.0.1:1/oauth/callback",
        clientId: CLIENT_ID_A,
      });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_AUTHORIZATION_CODE_FAILED")).toBe(true);
    }
  });
});
