import { describe, expect, it } from "vitest";
import { resetSkin, setSkinFromUrl, uploadSkin } from "../../src/auth/profile-mutations";
import { isErrorCode } from "../../src/core/errors";
import { FakeHttpClient } from "../helpers/fake-http";

const TOKEN = "MC-AT-1";
const SKIN_URL = "https://api.minecraftservices.com/minecraft/profile/skins";
const ACTIVE_SKIN_URL = "https://api.minecraftservices.com/minecraft/profile/skins/active";

const profileBody = (overrides: { activeSkin?: string } = {}): string =>
  JSON.stringify({
    id: "12345678123412341234123456789012",
    name: "Steve",
    skins: [
      {
        id: "skin-1",
        state:
          overrides.activeSkin === "skin-1" || overrides.activeSkin === undefined
            ? "ACTIVE"
            : "INACTIVE",
        url: "https://textures.minecraft.net/texture/skin-1",
        variant: "CLASSIC",
      },
    ],
  });

const lastRequest = (http: FakeHttpClient): { url: string; options?: Record<string, unknown> } => {
  const r = http.requests[http.requests.length - 1];
  if (!r) throw new Error("no requests recorded");
  return r as { url: string; options?: Record<string, unknown> };
};

describe("setSkinFromUrl", () => {
  it("POSTs JSON body with lowercased variant and brands the response as MinecraftProfile", async () => {
    const http = new FakeHttpClient().on(SKIN_URL, { status: 200, body: profileBody() });
    const profile = await setSkinFromUrl(http, {
      accessToken: TOKEN,
      url: "https://textures.minecraft.net/texture/abc",
      variant: "CLASSIC",
    });
    expect(profile.username).toBe("Steve");
    expect(profile.uuid).toBe("12345678-1234-1234-1234-123456789012");
    const req = lastRequest(http);
    expect(req.url).toBe(SKIN_URL);
    const opts = req.options as {
      method: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(opts.method).toBe("POST");
    expect(opts.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(opts.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({
      variant: "classic",
      url: "https://textures.minecraft.net/texture/abc",
    });
  });

  it("lowercases SLIM variant in the request body", async () => {
    const http = new FakeHttpClient().on(SKIN_URL, { status: 200, body: profileBody() });
    await setSkinFromUrl(http, {
      accessToken: TOKEN,
      url: "https://textures.minecraft.net/texture/abc",
      variant: "SLIM",
    });
    const opts = lastRequest(http).options as { body: string };
    expect(JSON.parse(opts.body).variant).toBe("slim");
  });

  it("maps a 401 to AUTH_MINECRAFT_FAILED with an actionable message", async () => {
    const http = new FakeHttpClient().on(SKIN_URL, { status: 401, body: "" });
    try {
      await setSkinFromUrl(http, {
        accessToken: TOKEN,
        url: "https://textures.minecraft.net/texture/abc",
        variant: "CLASSIC",
      });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_MINECRAFT_FAILED")).toBe(true);
    }
  });

  it("maps a 404 to AUTH_NO_GAME_OWNERSHIP", async () => {
    const http = new FakeHttpClient().on(SKIN_URL, { status: 404, body: "" });
    try {
      await setSkinFromUrl(http, {
        accessToken: TOKEN,
        url: "https://textures.minecraft.net/texture/abc",
        variant: "CLASSIC",
      });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_NO_GAME_OWNERSHIP")).toBe(true);
    }
  });

  it("embeds Mojang's response body in the error message and context", async () => {
    const body = JSON.stringify({
      path: "/minecraft/profile/skins",
      errorMessage: "Not a valid skin",
    });
    const http = new FakeHttpClient().on(SKIN_URL, { status: 400, body });
    try {
      await setSkinFromUrl(http, {
        accessToken: TOKEN,
        url: "https://textures.minecraft.net/texture/abc",
        variant: "CLASSIC",
      });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_MINECRAFT_FAILED")).toBe(true);
      const err = error as { message: string; context: Record<string, unknown> };
      expect(err.message).toContain("Profile mutation failed (HTTP 400)");
      expect(err.message).toContain("Not a valid skin");
      expect(err.context.httpStatus).toBe(400);
      expect(err.context.responseBody).toBe(body);
    }
  });
});

describe("uploadSkin", () => {
  it("POSTs multipart/form-data with variant + PNG file parts", async () => {
    const http = new FakeHttpClient().on(SKIN_URL, { status: 200, body: profileBody() });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const profile = await uploadSkin(http, {
      accessToken: TOKEN,
      skin: png,
      variant: "SLIM",
      fileName: "alex.png",
    });
    expect(profile.username).toBe("Steve");
    const opts = lastRequest(http).options as {
      method: string;
      headers: Record<string, string>;
      body: Uint8Array;
    };
    expect(opts.method).toBe("POST");
    const contentType = opts.headers["content-type"] ?? "";
    expect(contentType).toMatch(/^multipart\/form-data; boundary=----minecraft-kit-[0-9a-f]{32}$/);
    const boundary = contentType.split("boundary=")[1] ?? "";
    const body = new TextDecoder("latin1").decode(opts.body);
    expect(body).toContain(`--${boundary}\r\n`);
    expect(body).toContain('Content-Disposition: form-data; name="variant"');
    expect(body).toContain("\r\n\r\nslim\r\n");
    expect(body).toContain('Content-Disposition: form-data; name="file"; filename="alex.png"');
    expect(body).toContain("Content-Type: image/png");
    expect(body).toContain(`--${boundary}--\r\n`);
  });

  it("defaults the filename to skin.png when fileName is omitted", async () => {
    const http = new FakeHttpClient().on(SKIN_URL, { status: 200, body: profileBody() });
    await uploadSkin(http, {
      accessToken: TOKEN,
      skin: new Uint8Array([1, 2, 3]),
      variant: "CLASSIC",
    });
    const opts = lastRequest(http).options as { body: Uint8Array };
    const body = new TextDecoder("latin1").decode(opts.body);
    expect(body).toContain('filename="skin.png"');
  });
});

describe("resetSkin", () => {
  it("DELETEs /skins/active and returns the updated profile", async () => {
    const http = new FakeHttpClient().on(ACTIVE_SKIN_URL, {
      status: 200,
      body: profileBody({ activeSkin: "none" }),
    });
    const profile = await resetSkin(http, { accessToken: TOKEN });
    expect(profile.skins.filter((s) => s.state === "ACTIVE")).toEqual([]);
    const opts = lastRequest(http).options as {
      method: string;
      headers: Record<string, string>;
    };
    expect(opts.method).toBe("DELETE");
    expect(opts.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });
});
