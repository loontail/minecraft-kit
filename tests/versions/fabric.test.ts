import { describe, expect, it } from "vitest";
import { ApiEndpoints } from "../../src/constants/api";
import { silentLogger } from "../../src/core/logger";
import { createMemoryCache } from "../../src/http/cache";
import { VersionPreference } from "../../src/types/loader";
import { FabricVersionsApi } from "../../src/versions/fabric";
import { FakeHttpClient } from "../helpers/fake-http";

const compat = [
  {
    loader: { version: "0.15.0", stable: false, maven: "x", build: 0, separator: "." },
    intermediary: { version: "1", maven: "x", stable: true },
  },
  {
    loader: { version: "0.14.21", stable: true, maven: "x", build: 0, separator: "." },
    intermediary: { version: "1", maven: "x", stable: true },
  },
];

const profile = {
  id: "fabric-loader-0.14.21-1.20.1",
  inheritsFrom: "1.20.1",
  type: "release",
  mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
  libraries: [],
};

const gameVersions = [
  { version: "1.20.1", stable: true },
  { version: "24w14a", stable: false },
];

const buildKit = (): { api: FabricVersionsApi; http: FakeHttpClient } => {
  const http = new FakeHttpClient()
    .on(ApiEndpoints.fabric.loaderForGame("1.20.1"), { body: JSON.stringify(compat) })
    .on(ApiEndpoints.fabric.profile("1.20.1", "0.14.21"), { body: JSON.stringify(profile) })
    .on(ApiEndpoints.fabric.profile("1.20.1", "0.15.0"), {
      body: JSON.stringify({ ...profile, id: "fabric-loader-0.15.0-1.20.1" }),
    })
    .on(ApiEndpoints.fabric.loaderVersions(), {
      body: JSON.stringify(compat.map((c) => c.loader)),
    })
    .on(ApiEndpoints.fabric.gameVersions(), {
      body: JSON.stringify(gameVersions),
    });
  const api = new FabricVersionsApi({ http, cache: createMemoryCache(), logger: silentLogger });
  return { api, http };
};

describe("FabricVersionsApi", () => {
  it("lists for minecraft version", async () => {
    const { api } = buildKit();
    const list = await api.list({ minecraftVersion: "1.20.1" });
    expect(list.length).toBe(2);
  });

  it("lists all loaders", async () => {
    const { api } = buildKit();
    const list = await api.list();
    expect(list.length).toBe(2);
  });

  it("resolves recommended (stable) loader", async () => {
    const { api } = buildKit();
    const resolved = await api.resolve({
      minecraftVersion: "1.20.1",
      preference: VersionPreference.RECOMMENDED,
    });
    expect(resolved.loaderVersion).toBe("0.14.21");
  });

  it("resolves latest", async () => {
    const { api } = buildKit();
    const resolved = await api.resolve({ minecraftVersion: "1.20.1" });
    expect(resolved.loaderVersion).toBe("0.15.0");
  });

  it("resolves a specific version", async () => {
    const { api } = buildKit();
    const resolved = await api.resolve({ minecraftVersion: "1.20.1", loaderVersion: "0.14.21" });
    expect(resolved.loaderVersion).toBe("0.14.21");
  });

  it("rejects unknown loader version", async () => {
    const { api } = buildKit();
    await expect(
      api.resolve({ minecraftVersion: "1.20.1", loaderVersion: "9.9.9" }),
    ).rejects.toBeTruthy();
  });

  it("rejects when no loaders available", async () => {
    const http = new FakeHttpClient().on(ApiEndpoints.fabric.loaderForGame("nope"), {
      body: "[]",
    });
    const api = new FabricVersionsApi({ http, cache: createMemoryCache(), logger: silentLogger });
    await expect(api.resolve({ minecraftVersion: "nope" })).rejects.toBeTruthy();
  });

  it("lists game versions with branded ids", async () => {
    const { api } = buildKit();
    const entries = await api.gameVersions();
    expect(entries.length).toBe(2);
    expect(entries[0]).toEqual({ version: "1.20.1", stable: true });
    expect(entries[1]).toEqual({ version: "24w14a", stable: false });
  });

  it("caches game versions across calls", async () => {
    const { api, http } = buildKit();
    await api.gameVersions();
    await api.gameVersions();
    const hits = http.requests.filter((r) => r.url === ApiEndpoints.fabric.gameVersions());
    expect(hits.length).toBe(1);
  });

  it("rejects a profile JSON that does not match the expected shape", async () => {
    const http = new FakeHttpClient()
      .on(ApiEndpoints.fabric.loaderForGame("1.20.1"), { body: JSON.stringify(compat) })
      .on(ApiEndpoints.fabric.profile("1.20.1", "0.14.21"), {
        body: '{"id":"x","inheritsFrom":"1.20.1"}',
      });
    const api = new FabricVersionsApi({ http, cache: createMemoryCache(), logger: silentLogger });
    await expect(
      api.resolve({ minecraftVersion: "1.20.1", loaderVersion: "0.14.21" }),
    ).rejects.toMatchObject({ code: "MANIFEST_INVALID" });
  });
});
