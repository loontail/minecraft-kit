import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiEndpoints } from "../../src/constants/api";
import { silentLogger } from "../../src/core/logger";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { createPersistentMetadataCache } from "../../src/http/persistent-cache";
import { TargetsApi } from "../../src/targets/index";
import { Loaders } from "../../src/types/loader";
import type { RuntimeSystem } from "../../src/types/system";
import { FabricVersionsApi } from "../../src/versions/fabric";
import { ForgeVersionsApi } from "../../src/versions/forge";
import { MinecraftVersionsApi } from "../../src/versions/minecraft";
import { RuntimeVersionsApi } from "../../src/versions/runtime";
import { FakeHttpClient } from "../helpers/fake-http";

const system: RuntimeSystem = { os: "windows", arch: "x64", osVersion: "10.0" };

const versionRoot = {
  latest: { release: "1.20.1", snapshot: "1.20.1" },
  versions: [
    {
      id: "1.20.1",
      type: "release",
      url: "https://m/1.20.1",
      time: "t",
      releaseTime: "r",
      sha1: "rootsha1",
      complianceLevel: 1,
    },
  ],
};
const versionManifest = {
  id: "1.20.1",
  type: "release",
  mainClass: "x",
  assetIndex: { id: "5", sha1: "idxsha1", size: 1, totalSize: 1, url: "https://idx/" },
  assets: "5",
  downloads: { client: { sha1: "abc", size: 1, url: "https://c/" } },
  libraries: [],
  javaVersion: { component: "java-runtime-gamma", majorVersion: 17 },
};
const runtimeIndex = {
  "windows-x64": {
    "java-runtime-gamma": [
      {
        availability: { group: 1, progress: 100 },
        manifest: { sha1: "rmsha1", size: 1, url: "https://rm/" },
        version: { name: "17.0.8", released: "2024-01-01" },
      },
    ],
  },
};

const resolveInput = {
  id: "vanilla-1.20.1",
  directory: "/games/vanilla-1.20.1",
  minecraft: { version: asMinecraftVersionId("1.20.1") },
  loader: { type: Loaders.VANILLA },
} as const;

const onlineResolveHttp = (): FakeHttpClient =>
  new FakeHttpClient()
    .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
    .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
    .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) });

const buildTargets = (
  http: FakeHttpClient,
  cache: Awaited<ReturnType<typeof createPersistentMetadataCache>>,
) =>
  new TargetsApi({
    minecraft: new MinecraftVersionsApi({ http, cache, logger: silentLogger }),
    fabric: new FabricVersionsApi({ http, cache, logger: silentLogger }),
    forge: new ForgeVersionsApi({ http, cache, logger: silentLogger }),
    runtime: new RuntimeVersionsApi({ http, cache, logger: silentLogger }),
    system,
  });

describe("createPersistentMetadataCache", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "mckit-persistent-cache-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("survives a process restart: a value written by one instance is readable by the next", async () => {
    const first = await createPersistentMetadataCache({ directory });
    first.set("manifest-key", { hello: "world" });
    await first.flush();

    const second = await createPersistentMetadataCache({ directory });
    expect(second.get<{ hello: string }>("manifest-key")).toEqual({ hello: "world" });
  });

  it("drops entries that have passed their retention on hydration", async () => {
    await writeFile(
      path.join(directory, "expired.json"),
      JSON.stringify({ key: "stale", value: 1, expiresAt: Date.now() - 1_000 }),
    );

    const cache = await createPersistentMetadataCache({ directory });
    expect(cache.get("stale")).toBeUndefined();
  });

  it("does not rehydrate a deleted entry", async () => {
    const first = await createPersistentMetadataCache({ directory });
    first.set("k", 1);
    first.delete("k");
    await first.flush();

    const second = await createPersistentMetadataCache({ directory });
    expect(second.get("k")).toBeUndefined();
  });

  it("resolves a previously-resolved target offline from the persisted cache", async () => {
    const online = onlineResolveHttp();
    const writer = await createPersistentMetadataCache({ directory });
    const onlineTargets = buildTargets(online, writer);
    const resolvedOnline = await onlineTargets.resolve(resolveInput);
    expect(resolvedOnline.minecraft.version).toBe("1.20.1");
    await writer.flush();

    const offline = new FakeHttpClient();
    const reader = await createPersistentMetadataCache({ directory });
    const offlineTargets = buildTargets(offline, reader);
    const resolvedOffline = await offlineTargets.resolve(resolveInput);

    expect(resolvedOffline.minecraft.version).toBe("1.20.1");
    expect(resolvedOffline.runtime.component).toBe("java-runtime-gamma");
    expect(offline.requests).toHaveLength(0);
  });
});
