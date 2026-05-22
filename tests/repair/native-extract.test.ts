import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApiEndpoints } from "../../src/constants/api";
import { silentLogger } from "../../src/core/logger";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { createMemoryCache } from "../../src/http/cache";
import { planMinecraftRepair } from "../../src/repair/minecraft";
import { TargetsApi } from "../../src/targets/index";
import { Loaders } from "../../src/types/loader";
import type { RuntimeSystem } from "../../src/types/system";
import {
  VerificationKinds,
  VerifyFileCategories,
  VerifyFileStatuses,
} from "../../src/types/verify";
import { FabricVersionsApi } from "../../src/versions/fabric";
import { ForgeVersionsApi } from "../../src/versions/forge";
import { MinecraftVersionsApi } from "../../src/versions/minecraft";
import { RuntimeVersionsApi } from "../../src/versions/runtime";
import { FakeHttpClient } from "../helpers/fake-http";

const system: RuntimeSystem = { os: "windows", arch: "x64", osVersion: "10.0" };

describe("planMinecraftRepair — NATIVE-category issues", () => {
  it("triggers EXTRACT_NATIVE without re-downloading the JAR when only a NATIVE issue is present", async () => {
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
    const lwjglUrl = "https://lib/lwjgl-natives.jar";
    const versionManifest = {
      id: "1.20.1",
      type: "release",
      mainClass: "x",
      assetIndex: { id: "5", sha1: "x", size: 1, totalSize: 1, url: "https://idx/" },
      assets: "5",
      downloads: { client: { sha1: "abc", size: 1, url: "https://c/" } },
      libraries: [
        {
          name: "org.lwjgl:lwjgl-platform:2.9.4-nightly-20150209",
          downloads: {
            classifiers: {
              "natives-windows": {
                path: "org/lwjgl/lwjgl-platform/2.9.4-nightly-20150209/lwjgl-platform-2.9.4-nightly-20150209-natives-windows.jar",
                sha1: "deadbeef",
                size: 100,
                url: lwjglUrl,
              },
            },
          },
          natives: { windows: "natives-windows" },
        },
      ],
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
    const http = new FakeHttpClient()
      .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
      .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
      .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
      .on("https://idx/", { body: '{"objects":{}}' })
      .on("https://rm/", { body: '{"files":{}}' });
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
      minecraft: { version: asMinecraftVersionId("1.20.1") },
      loader: { type: Loaders.VANILLA },
    });

    const nativeJarPath = path.join(
      "/r",
      "libraries",
      "org",
      "lwjgl",
      "lwjgl-platform",
      "2.9.4-nightly-20150209",
      "lwjgl-platform-2.9.4-nightly-20150209-natives-windows.jar",
    );

    const nativeOnlyVerification = {
      targetId: target.id,
      kind: VerificationKinds.MINECRAFT,
      isValid: false,
      issues: [
        {
          path: nativeJarPath,
          category: VerifyFileCategories.NATIVE,
          status: VerifyFileStatuses.MISSING,
        },
      ],
      checkedFiles: 1,
      durationMs: 1,
    };
    const plan = await planMinecraftRepair({ target, http, cache, from: nativeOnlyVerification });
    const downloads = plan.actions.filter((a) => a.kind === "download-file");
    const extracts = plan.actions.filter((a) => a.kind === "extract-native");
    expect(downloads.length).toBe(0);
    expect(extracts.length).toBe(1);
    expect(plan.totalActions).toBe(1);
  });

  it("triggers BOTH DOWNLOAD_FILE and EXTRACT_NATIVE when a LIBRARY issue is present", async () => {
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
      libraries: [
        {
          name: "org.lwjgl:lwjgl-platform:2.9.4-nightly-20150209",
          downloads: {
            classifiers: {
              "natives-windows": {
                path: "org/lwjgl/lwjgl-platform/2.9.4-nightly-20150209/lwjgl-platform-2.9.4-nightly-20150209-natives-windows.jar",
                sha1: "deadbeef",
                size: 100,
                url: "https://lib/lwjgl.jar",
              },
            },
          },
          natives: { windows: "natives-windows" },
        },
      ],
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
    const http = new FakeHttpClient()
      .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
      .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
      .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
      .on("https://idx/", { body: '{"objects":{}}' })
      .on("https://rm/", { body: '{"files":{}}' });
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
      minecraft: { version: asMinecraftVersionId("1.20.1") },
      loader: { type: Loaders.VANILLA },
    });
    const nativeJarPath = path.join(
      "/r",
      "libraries",
      "org",
      "lwjgl",
      "lwjgl-platform",
      "2.9.4-nightly-20150209",
      "lwjgl-platform-2.9.4-nightly-20150209-natives-windows.jar",
    );
    const verification = {
      targetId: target.id,
      kind: VerificationKinds.MINECRAFT,
      isValid: false,
      issues: [
        {
          path: nativeJarPath,
          category: VerifyFileCategories.LIBRARY,
          status: VerifyFileStatuses.MISSING,
        },
      ],
      checkedFiles: 1,
      durationMs: 1,
    };
    const plan = await planMinecraftRepair({ target, http, cache, from: verification });
    const downloads = plan.actions.filter((a) => a.kind === "download-file");
    const extracts = plan.actions.filter((a) => a.kind === "extract-native");
    expect(downloads.length).toBe(1);
    expect(extracts.length).toBe(1);
  });
});
