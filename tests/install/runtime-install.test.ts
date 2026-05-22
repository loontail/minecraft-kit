import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApiEndpoints } from "../../src/constants/api";
import { silentLogger } from "../../src/core/logger";
import { createMemoryCache } from "../../src/http/cache";
import { planRuntimeInstall } from "../../src/install/runtime-install";
import { TargetsApi } from "../../src/targets/index";
import { Loaders } from "../../src/types/loader";
import type { RuntimeSystem } from "../../src/types/system";
import { FabricVersionsApi } from "../../src/versions/fabric";
import { ForgeVersionsApi } from "../../src/versions/forge";
import { MinecraftVersionsApi } from "../../src/versions/minecraft";
import { RuntimeVersionsApi } from "../../src/versions/runtime";
import { FakeHttpClient } from "../helpers/fake-http";

const system: RuntimeSystem = { os: "windows", arch: "x64", osVersion: "10.0" };

describe("planRuntimeInstall", () => {
  it("returns ONLY runtime-file actions, no client jar / libraries / assets", async () => {
    const versionRoot = {
      latest: { release: "1.20.1", snapshot: "1.20.1" },
      versions: [
        {
          id: "1.20.1",
          type: "release",
          url: "https://m/1.20.1",
          time: "t",
          releaseTime: "r",
          sha1: "x",
          complianceLevel: 1,
        },
      ],
    };
    const versionManifest = {
      id: "1.20.1",
      type: "release",
      mainClass: "x",
      assetIndex: { id: "5", sha1: "x", size: 1, totalSize: 1, url: "https://idx/" },
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
            manifest: { sha1: "x", size: 1, url: "https://rm/" },
            version: { name: "17.0.8", released: "2024-01-01" },
          },
        ],
      },
    };
    const runtimeManifest = JSON.stringify({
      files: {
        "bin/javaw.exe": {
          type: "file",
          executable: true,
          downloads: { raw: { sha1: "deadbeef", size: 100, url: "https://rt/javaw" } },
        },
        "lib/jvm.dll": {
          type: "file",
          executable: false,
          downloads: { raw: { sha1: "cafebabe", size: 200, url: "https://rt/jvm" } },
        },
        "bin/empty-dir": { type: "directory" },
      },
    });
    const http = new FakeHttpClient()
      .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
      .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
      .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
      .on("https://rm/", { body: runtimeManifest });
    const cache = createMemoryCache();
    const targets = new TargetsApi({
      minecraft: new MinecraftVersionsApi({ http, cache, logger: silentLogger }),
      fabric: new FabricVersionsApi({ http, cache, logger: silentLogger }),
      forge: new ForgeVersionsApi({ http, cache, logger: silentLogger }),
      runtime: new RuntimeVersionsApi({ http, cache, logger: silentLogger }),
      system,
    });
    const target = await targets.resolve({
      id: "x",
      directory: "/r",
      minecraft: { version: "1.20.1" },
      loader: { type: Loaders.VANILLA },
    });

    const plan = await planRuntimeInstall({ target, http, cache });
    expect(plan.actions.length).toBe(2);
    for (const action of plan.actions) {
      expect(action.kind).toBe("download-file");
      if (action.kind === "download-file") {
        expect(action.category).toBe("runtime-file");
      }
    }
    const categories = plan.actions
      .filter((a) => a.kind === "download-file")
      .map((a) => (a as { readonly category: string }).category);
    expect(categories).not.toContain("client-jar");
    expect(categories).not.toContain("library");
    expect(categories).not.toContain("asset");
  });

  it("places runtime files under installRoot when set", async () => {
    const versionRoot = {
      latest: { release: "1.20.1", snapshot: "1.20.1" },
      versions: [
        {
          id: "1.20.1",
          type: "release",
          url: "https://m/1.20.1",
          time: "t",
          releaseTime: "r",
          sha1: "x",
          complianceLevel: 1,
        },
      ],
    };
    const versionManifest = {
      id: "1.20.1",
      type: "release",
      mainClass: "x",
      assetIndex: { id: "5", sha1: "x", size: 1, totalSize: 1, url: "https://idx/" },
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
            manifest: { sha1: "x", size: 1, url: "https://rm/" },
            version: { name: "17.0.8", released: "2024-01-01" },
          },
        ],
      },
    };
    const runtimeManifest = JSON.stringify({
      files: {
        "bin/javaw.exe": {
          type: "file",
          executable: true,
          downloads: { raw: { sha1: "deadbeef", size: 100, url: "https://rt/javaw" } },
        },
      },
    });
    const http = new FakeHttpClient()
      .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
      .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
      .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
      .on("https://rm/", { body: runtimeManifest });
    const cache = createMemoryCache();
    const targets = new TargetsApi({
      minecraft: new MinecraftVersionsApi({ http, cache, logger: silentLogger }),
      fabric: new FabricVersionsApi({ http, cache, logger: silentLogger }),
      forge: new ForgeVersionsApi({ http, cache, logger: silentLogger }),
      runtime: new RuntimeVersionsApi({ http, cache, logger: silentLogger }),
      system,
    });
    const customRoot = "/global-runtimes";
    const target = await targets.resolve({
      id: "x",
      directory: "/r",
      minecraft: { version: "1.20.1" },
      loader: { type: Loaders.VANILLA },
      runtime: { installRoot: customRoot },
    });

    const plan = await planRuntimeInstall({ target, http, cache });
    expect(plan.actions.length).toBe(1);
    const action = plan.actions[0];
    if (action === undefined) throw new Error("expected one action");
    if (action.kind === "download-file") {
      expect(action.target).toBe(path.join(customRoot, "java-runtime-gamma", "bin", "javaw.exe"));
    }
  });
});
