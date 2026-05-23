import { describe, expect, it } from "vitest";
import { extractXuid, fetchMinecraftProfile, loginWithXbox } from "../../src/auth/minecraft";
import { isErrorCode } from "../../src/core/errors";
import { FakeHttpClient } from "../helpers/fake-http";

const LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox";
const PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";

describe("loginWithXbox", () => {
  it("returns the Minecraft access token on success", async () => {
    const http = new FakeHttpClient().on(LOGIN_URL, {
      body: JSON.stringify({ access_token: "mc-at", expires_in: 86400 }),
    });
    const result = await loginWithXbox({ http, userHash: "uhs", xstsToken: "xsts" });
    expect(result).toEqual({ accessToken: "mc-at", expiresIn: 86400 });
  });

  it("translates 403 + 'invalid app registration' into AUTH_MINECRAFT_FAILED with a precise hint", async () => {
    const http = new FakeHttpClient().on(LOGIN_URL, {
      status: 403,
      body: "Invalid app registration: client not allowlisted",
    });
    try {
      await loginWithXbox({ http, userHash: "uhs", xstsToken: "xsts" });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_MINECRAFT_FAILED")).toBe(true);
      expect((error as Error).message).toMatch(/aka\.ms\/mce-reviewappid/i);
    }
  });

  it("treats a generic 403 as AUTH_NO_GAME_OWNERSHIP", async () => {
    const http = new FakeHttpClient().on(LOGIN_URL, {
      status: 403,
      body: "FORBIDDEN",
    });
    try {
      await loginWithXbox({ http, userHash: "uhs", xstsToken: "xsts" });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_NO_GAME_OWNERSHIP")).toBe(true);
    }
  });

  it("throws AUTH_MINECRAFT_FAILED when the success body has no access token", async () => {
    const http = new FakeHttpClient().on(LOGIN_URL, {
      body: JSON.stringify({ expires_in: 86400 }),
    });
    try {
      await loginWithXbox({ http, userHash: "uhs", xstsToken: "xsts" });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_MINECRAFT_FAILED")).toBe(true);
    }
  });
});

describe("fetchMinecraftProfile", () => {
  it("dashes the bare UUID and returns the profile", async () => {
    const http = new FakeHttpClient().on(PROFILE_URL, {
      body: JSON.stringify({ id: "12345678123412341234123456789012", name: "Steve" }),
    });
    const profile = await fetchMinecraftProfile({ http, accessToken: "AT" });
    expect(profile.username).toBe("Steve");
    expect(profile.uuid).toBe("12345678-1234-1234-1234-123456789012");
  });

  it("preserves an already-dashed UUID", async () => {
    const http = new FakeHttpClient().on(PROFILE_URL, {
      body: JSON.stringify({
        id: "12345678-1234-1234-1234-123456789012",
        name: "Steve",
      }),
    });
    const profile = await fetchMinecraftProfile({ http, accessToken: "AT" });
    expect(profile.uuid).toBe("12345678-1234-1234-1234-123456789012");
  });

  it("translates 404 to AUTH_NO_GAME_OWNERSHIP", async () => {
    const http = new FakeHttpClient().on(PROFILE_URL, {
      status: 404,
      body: "",
    });
    try {
      await fetchMinecraftProfile({ http, accessToken: "AT" });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_NO_GAME_OWNERSHIP")).toBe(true);
    }
  });

  it("rejects when the response is missing required fields", async () => {
    const http = new FakeHttpClient().on(PROFILE_URL, {
      body: JSON.stringify({ id: "abc" }),
    });
    try {
      await fetchMinecraftProfile({ http, accessToken: "AT" });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_MINECRAFT_FAILED")).toBe(true);
    }
  });

  it("defaults skins to an empty array when Mojang omits them", async () => {
    const http = new FakeHttpClient().on(PROFILE_URL, {
      body: JSON.stringify({ id: "12345678123412341234123456789012", name: "Steve" }),
    });
    const profile = await fetchMinecraftProfile({ http, accessToken: "AT" });
    expect(profile.skins).toEqual([]);
  });

  it("plumbs skin slots through, dropping malformed rows", async () => {
    const http = new FakeHttpClient().on(PROFILE_URL, {
      body: JSON.stringify({
        id: "12345678123412341234123456789012",
        name: "Steve",
        skins: [
          {
            id: "skin-a",
            state: "ACTIVE",
            url: "http://textures/skin-a.png",
            variant: "CLASSIC",
          },
          {
            id: "skin-b-unknown-state-dropped",
            state: "WEIRD",
            url: "http://x",
            variant: "CLASSIC",
          },
          { id: "skin-c-missing-url-dropped", state: "INACTIVE", variant: "SLIM" },
        ],
      }),
    });
    const profile = await fetchMinecraftProfile({ http, accessToken: "AT" });
    expect(profile.skins).toEqual([
      {
        id: "skin-a",
        state: "ACTIVE",
        url: "http://textures/skin-a.png",
        variant: "CLASSIC",
      },
    ]);
  });
});

describe("extractXuid", () => {
  function buildJwt(payload: Record<string, unknown>): string {
    const b64 = (s: string): string =>
      Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    return `${b64("hdr")}.${b64(JSON.stringify(payload))}.${b64("sig")}`;
  }

  it("plucks xuid from the middle segment of a JWT-ish access token", () => {
    expect(extractXuid(buildJwt({ xuid: "xuid-1" }))).toBe("xuid-1");
  });

  it("returns '' when the token has no payload segment", () => {
    expect(extractXuid("not-a-jwt")).toBe("");
  });

  it("returns '' when xuid is missing from the payload", () => {
    expect(extractXuid(buildJwt({ sub: "user" }))).toBe("");
  });

  it("returns '' when the payload is not valid base64-encoded JSON", () => {
    expect(extractXuid("a.@notbase64@.b")).toBe("");
  });
});
