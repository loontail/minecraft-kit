import { describe, expect, it } from "vitest";
import { MojangAuthApi, toOnlineAuth } from "../../src/auth/index";
import { isErrorCode } from "../../src/core/errors";
import { AuthModes, type MojangSession } from "../../src/types/auth";
import { FakeHttpClient } from "../helpers/fake-http";

const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_URL = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";

// Build a JWT-ish access token whose middle segment decodes to JSON. The Minecraft auth
// flow plucks `xuid` out of this segment, so a realistic shape avoids "" xuid noise.
const buildAccessToken = (payload: Record<string, unknown>): string => {
  const b64 = (s: string): string =>
    Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64("hdr")}.${b64(JSON.stringify(payload))}.${b64("sig")}`;
};

describe("MojangAuthApi.login", () => {
  it("throws AUTH_MISSING_CLIENT_ID when neither option nor env is set", async () => {
    const http = new FakeHttpClient();
    const api = new MojangAuthApi(http);
    const previous = process.env.MINECRAFT_KIT_MSA_CLIENT_ID;
    process.env.MINECRAFT_KIT_MSA_CLIENT_ID = "";
    try {
      await api.login({ onPrompt: () => undefined });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_MISSING_CLIENT_ID")).toBe(true);
    } finally {
      if (previous !== undefined) {
        process.env.MINECRAFT_KIT_MSA_CLIENT_ID = previous;
      } else {
        process.env.MINECRAFT_KIT_MSA_CLIENT_ID = "";
      }
    }
  });
});

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
    const session = await api.refresh("RT-1", { clientId: "c" });
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
      clientId: "client-1",
      onOpenBrowser: async (url) => {
        capturedUrl = url;
        // Simulate the browser landing on the loopback redirect with a fake code.
        const parsed = new URL(url);
        const redirectUri = parsed.searchParams.get("redirect_uri");
        const state = parsed.searchParams.get("state");
        const response = await fetch(`${redirectUri}?code=FAKE-CODE&state=${state}`);
        expect(response.status).toBe(200);
      },
    });

    expect(session.minecraft.username).toBe("Steve");
    expect(session.minecraft.uuid).toBe("12345678-1234-1234-1234-123456789012");
    expect(session.microsoft.refreshToken).toBe("MS-RT");
    expect(session.microsoft.clientId).toBe("client-1");

    // Authorize URL is well-formed with PKCE + state + select_account.
    expect(capturedUrl).not.toBeNull();
    const authorizeUrl = new URL(capturedUrl as unknown as string);
    expect(authorizeUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizeUrl.searchParams.get("client_id")).toBe("client-1");
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authorizeUrl.searchParams.get("state")).toBeTruthy();
    expect(authorizeUrl.searchParams.get("prompt")).toBe("select_account");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toMatch(/^http:\/\/localhost:\d+$/);
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
      microsoft: { refreshToken: "rt", clientId: "c" },
    };
    const auth = toOnlineAuth(session);
    expect(auth.mode).toBe(AuthModes.ONLINE);
    expect(auth.userType).toBe("msa");
    expect(auth.username).toBe("Steve");
    expect(auth.clientId).toBe("c");
    expect(auth.xuid).toBe("xuid");
  });
});
