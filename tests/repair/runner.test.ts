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

describe("planRepair", () => {
  it("filters install plan to issue paths", async () => {
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
    const http = new FakeHttpClient()
      .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
      .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
      .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
      .on("https://idx/", { body: '{"objects":{}}' })
      .on("https://rm/", { body: '{"files":{}}' });
    const cache = createMemoryCache();
    const ctx = { http, cache, logger: silentLogger };
    const targets = new TargetsApi({
      minecraft: new MinecraftVersionsApi(ctx),
      fabric: new FabricVersionsApi(ctx),
      forge: new ForgeVersionsApi(ctx),
      runtime: new RuntimeVersionsApi(ctx),
      system,
    });
    const target = await targets.resolve({
      id: "x",
      directory: "/r",
      minecraft: { version: asMinecraftVersionId("1.20.1") },
      loader: { type: Loaders.VANILLA },
    });
    const verification = {
      targetId: "x",
      kind: VerificationKinds.MINECRAFT,
      isValid: false,
      issues: [
        {
          path: path.join("/r", "versions", "1.20.1", "1.20.1.jar"),
          category: VerifyFileCategories.CLIENT_JAR,
          status: VerifyFileStatuses.MISSING,
        },
      ],
      checkedFiles: 1,
      durationMs: 1,
    };
    const plan = await planMinecraftRepair({ target, from: verification, http, cache });
    expect(plan.actions.length).toBe(1);
  });
});
