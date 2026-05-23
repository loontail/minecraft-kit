import { describe, expect, it } from "vitest";
import { readProfile } from "../../src/auth/profile-read";
import { isErrorCode } from "../../src/core/errors";
import { FakeHttpClient } from "../helpers/fake-http";

const TOKEN = "MC-AT-1";
const PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";

const profileBody = (): string =>
  JSON.stringify({
    id: "12345678123412341234123456789012",
    name: "Steve",
    skins: [
      {
        id: "skin-1",
        state: "ACTIVE",
        url: "https://textures.minecraft.net/texture/skin-1",
        variant: "CLASSIC",
      },
    ],
  });

describe("readProfile", () => {
  it("GETs /minecraft/profile with bearer auth and returns the parsed MinecraftProfile", async () => {
    const http = new FakeHttpClient().on(PROFILE_URL, { status: 200, body: profileBody() });
    const profile = await readProfile(http, { accessToken: TOKEN });
    expect(profile.username).toBe("Steve");
    expect(profile.uuid).toBe("12345678-1234-1234-1234-123456789012");
    expect(profile.skins).toEqual([
      {
        id: "skin-1",
        state: "ACTIVE",
        url: "https://textures.minecraft.net/texture/skin-1",
        variant: "CLASSIC",
      },
    ]);
    const req = http.requests[0];
    if (!req) throw new Error("no request recorded");
    expect(req.url).toBe(PROFILE_URL);
    const opts = req.options as { method?: string; headers: Record<string, string> } | undefined;
    expect(opts?.method).toBeUndefined();
    expect(opts?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("maps a 401 to AUTH_MINECRAFT_FAILED", async () => {
    const http = new FakeHttpClient().on(PROFILE_URL, { status: 401, body: "" });
    try {
      await readProfile(http, { accessToken: TOKEN });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_MINECRAFT_FAILED")).toBe(true);
    }
  });

  it("maps a 404 to AUTH_NO_GAME_OWNERSHIP", async () => {
    const http = new FakeHttpClient().on(PROFILE_URL, { status: 404, body: "" });
    try {
      await readProfile(http, { accessToken: TOKEN });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_NO_GAME_OWNERSHIP")).toBe(true);
    }
  });

  it("forwards the AbortSignal through to the underlying request", async () => {
    const http = new FakeHttpClient().on(PROFILE_URL, { status: 200, body: profileBody() });
    const controller = new AbortController();
    await readProfile(http, { accessToken: TOKEN, signal: controller.signal });
    expect(http.requests[0]?.options?.signal).toBe(controller.signal);
  });
});
