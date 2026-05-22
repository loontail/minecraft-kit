import { describe, expect, it } from "vitest";
import { MojangAuthApi, asAzureClientId, toOnlineAuth } from "../../src/auth/index";
import { AuthModes, type MojangSession } from "../../src/types/auth";
import { FakeHttpClient } from "../helpers/fake-http";

const CLIENT_ID_REFRESH = asAzureClientId("00000000-0000-0000-0000-000000000000");
const CLIENT_ID_AUTH_CODE = asAzureClientId("11111111-1111-1111-1111-111111111111");
const CLIENT_ID_TO_ONLINE = asAzureClientId("22222222-2222-2222-2222-222222222222");

const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_URL = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";

/**
 * Build a JWT-ish access token whose middle segment decodes to JSON. The Minecraft auth
 * flow plucks `xuid` out of this segment, so a realistic shape avoids empty-xuid noise.
 */
const buildAccessToken = (payload: Record<string, unknown>): string => {
  const b64 = (s: string): string =>
    Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64("hdr")}.${b64(JSON.stringify(payload))}.${b64("sig")}`;
};

const simulateBrowserCallbackHittingLoopback = async (authorizeUrl: string): Promise<Response> => {
  const parsed = new URL(authorizeUrl);
  const redirectUri = parsed.searchParams.get("redirect_uri");
  const state = parsed.searchParams.get("state");
  return fetch(`${redirectUri}?code=FAKE-CODE&state=${state}`);
};

const assertAuthorizeUrlWellFormed = (authorizeUrl: string, expectedClientId: string): void => {
  const url = new URL(authorizeUrl);
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("client_id")).toBe(expectedClientId);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).toBeTruthy();
  expect(url.searchParams.get("state")).toBeTruthy();
  expect(url.searchParams.get("prompt")).toBe("select_account");
  expect(url.searchParams.get("redirect_uri")).toMatch(/^http:\/\/localhost:\d+$/);
};

describe("MojangAuthApi.refresh", () => {
  it("uses the refresh token to fetch a fresh Minecraft session", async () => {
    const accessToken = buildAccessToken({ xuid: "xbox-uid-1" });
    const http = new FakeHttpClient()
      .on(TOKEN_URL, {
        body: JSON.stringify({
          token_type: "Bearer",
          scope: "X",
          expires_in: 3600,
          access_token: "MS-AT2",
          refresh_token: "MS-RT2",
        }),
      })
      .on(XBL_URL, {
        body: JSON.stringify({
          Token: "XBL-T",
          DisplayClaims: { xui: [{ uhs: "uhs-1" }] },
        }),
      })
      .on(XSTS_URL, {
        body: JSON.stringify({
          Token: "XSTS-T",
          DisplayClaims: { xui: [{ uhs: "uhs-1" }] },
        }),
      })
      .on(MC_LOGIN_URL, {
        body: JSON.stringify({ access_token: accessToken, expires_in: 86400 }),
      })
      .on(MC_PROFILE_URL, {
        body: JSON.stringify({
          id: "11111111111111111111111111111111",
          name: "Alex",
        }),
      });

    const api = new MojangAuthApi(http);
    const session = await api.refresh("RT-1", { clientId: CLIENT_ID_REFRESH });
    expect(session.minecraft.username).toBe("Alex");
    expect(session.microsoft.refreshToken).toBe("MS-RT2");
  });
});

describe("MojangAuthApi.authorizationCode.run", () => {
  it("runs the full browser flow end-to-end via the loopback server", async () => {
    const accessToken = buildAccessToken({ xuid: "xbox-uid-1" });
    const http = new FakeHttpClient()
      .on(TOKEN_URL, {
        body: JSON.stringify({
          token_type: "Bearer",
          scope: "X",
          expires_in: 3600,
          access_token: "MS-AT",
          refresh_token: "MS-RT",
        }),
      })
      .on(XBL_URL, {
        body: JSON.stringify({ Token: "XBL-T", DisplayClaims: { xui: [{ uhs: "uhs-1" }] } }),
      })
      .on(XSTS_URL, {
        body: JSON.stringify({ Token: "XSTS-T", DisplayClaims: { xui: [{ uhs: "uhs-1" }] } }),
      })
      .on(MC_LOGIN_URL, {
        body: JSON.stringify({ access_token: accessToken, expires_in: 86400 }),
      })
      .on(MC_PROFILE_URL, {
        body: JSON.stringify({ id: "12345678123412341234123456789012", name: "Steve" }),
      });

    const api = new MojangAuthApi(http);
    let capturedUrl: string | null = null;

    const session = await api.authorizationCode.run({
      clientId: CLIENT_ID_AUTH_CODE,
      onOpenBrowser: async (url) => {
        capturedUrl = url;
        const response = await simulateBrowserCallbackHittingLoopback(url);
        expect(response.status).toBe(200);
      },
    });

    expect(session.minecraft.username).toBe("Steve");
    expect(session.minecraft.uuid).toBe("12345678-1234-1234-1234-123456789012");
    expect(session.microsoft.refreshToken).toBe("MS-RT");
    expect(session.microsoft.clientId).toBe(CLIENT_ID_AUTH_CODE);

    expect(capturedUrl).not.toBeNull();
    assertAuthorizeUrlWellFormed(capturedUrl as unknown as string, CLIENT_ID_AUTH_CODE);
  });
});

describe("toOnlineAuth", () => {
  it("projects a session into the launch-compose OnlineAuth shape", () => {
    const session: MojangSession = {
      minecraft: {
        username: "Steve",
        uuid: "uuid",
        accessToken: "at",
        expiresAt: 0,
        xuid: "xuid",
        skins: [],
        capes: [],
      },
      microsoft: { refreshToken: "rt", clientId: CLIENT_ID_TO_ONLINE },
    };
    const auth = toOnlineAuth(session);
    expect(auth.mode).toBe(AuthModes.ONLINE);
    expect(auth.userType).toBe("msa");
    expect(auth.username).toBe("Steve");
    expect(auth.clientId).toBe(CLIENT_ID_TO_ONLINE);
    expect(auth.xuid).toBe("xuid");
  });
});
