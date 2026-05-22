import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApiEndpoints } from "../../src/constants/api";
import { silentLogger } from "../../src/core/logger";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { createMemoryCache } from "../../src/http/cache";
import { planFabricRepair } from "../../src/repair/fabric";
import { planForgeRepair } from "../../src/repair/forge";
import { planMinecraftRepair } from "../../src/repair/minecraft";
import { planRuntimeRepair } from "../../src/repair/runtime";
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

const buildHttp = (extra: Record<string, string> = {}): FakeHttpClient => {
  const http = new FakeHttpClient()
    .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
    .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
    .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
    .on("https://idx/", { body: '{"objects":{}}' })
    .on("https://rm/", { body: '{"files":{}}' });
  for (const [url, body] of Object.entries(extra)) http.on(url, { body });
  return http;
};

const buildVanillaTarget = (http: FakeHttpClient, opts: { runtimeInstallRoot?: string } = {}) => {
  const cache = createMemoryCache();
  const targets = new TargetsApi({
    minecraft: new MinecraftVersionsApi({ http, cache, logger: silentLogger }),
    fabric: new FabricVersionsApi({ http, cache, logger: silentLogger }),
    forge: new ForgeVersionsApi({ http, cache, logger: silentLogger }),
    runtime: new RuntimeVersionsApi({ http, cache, logger: silentLogger }),
    system,
  });
  return targets.resolve({
    id: "x",
    directory: "/r",
    minecraft: { version: asMinecraftVersionId("1.20.1") },
    loader: { type: Loaders.VANILLA },
    ...(opts.runtimeInstallRoot !== undefined
      ? { runtime: { installRoot: opts.runtimeInstallRoot } }
      : {}),
  });
};

describe("planMinecraftRepair", () => {
  it("includes the client jar when its path is reported missing", async () => {
    const http = buildHttp();
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http);
    const plan = await planMinecraftRepair({
      target,
      http,
      cache,
      from: {
        targetId: target.id,
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
      },
    });
    expect(plan.actions.length).toBe(1);
    expect(plan.actions[0]?.kind).toBe("download-file");
  });

  it("ignores runtime-file issues — those belong to the runtime aspect", async () => {
    const http = buildHttp();
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http);
    const plan = await planMinecraftRepair({
      target,
      http,
      cache,
      from: {
        targetId: target.id,
        kind: VerificationKinds.RUNTIME,
        isValid: false,
        issues: [
          {
            path: path.join("/r", "runtime", "java-runtime-gamma", "bin", "javaw.exe"),
            category: VerifyFileCategories.RUNTIME_FILE,
            status: VerifyFileStatuses.MISSING,
          },
        ],
        checkedFiles: 1,
        durationMs: 1,
      },
    });
    expect(plan.actions.length).toBe(0);
  });
});

describe("planFabricRepair", () => {
  it("rejects non-Fabric targets", async () => {
    const http = buildHttp();
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http);
    await expect(
      planFabricRepair({
        target,
        http,
        cache,
        from: {
          targetId: target.id,
          kind: VerificationKinds.FABRIC,
          isValid: true,
          issues: [],
          checkedFiles: 0,
          durationMs: 1,
        },
      }),
    ).rejects.toThrow(/requires a Fabric target/);
  });
});

describe("planForgeRepair", () => {
  it("rejects non-Forge targets", async () => {
    const http = buildHttp();
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http);
    await expect(
      planForgeRepair({
        target,
        http,
        cache,
        from: {
          targetId: target.id,
          kind: VerificationKinds.FORGE,
          isValid: true,
          issues: [],
          checkedFiles: 0,
          durationMs: 1,
        },
      }),
    ).rejects.toThrow(/requires a Forge target/);
  });
});

describe("planRuntimeRepair with installRoot", () => {
  it("only includes runtime-file actions and respects installRoot in paths", async () => {
    const customRoot = "/global-runtimes";
    const runtimeManifest = JSON.stringify({
      files: {
        "bin/javaw.exe": {
          type: "file",
          executable: true,
          downloads: { raw: { sha1: "deadbeef", size: 100, url: "https://rt/javaw" } },
        },
      },
    });
    const http = buildHttp({ "https://rm/": runtimeManifest });
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http, { runtimeInstallRoot: customRoot });
    const expectedRuntimePath = path.join(customRoot, "java-runtime-gamma", "bin", "javaw.exe");
    const plan = await planRuntimeRepair({
      target,
      http,
      cache,
      from: {
        targetId: target.id,
        kind: VerificationKinds.RUNTIME,
        isValid: false,
        issues: [
          {
            path: expectedRuntimePath,
            category: VerifyFileCategories.RUNTIME_FILE,
            status: VerifyFileStatuses.MISSING,
          },
          {
            path: path.join("/r", "versions", "1.20.1", "1.20.1.jar"),
            category: VerifyFileCategories.CLIENT_JAR,
            status: VerifyFileStatuses.MISSING,
          },
        ],
        checkedFiles: 2,
        durationMs: 1,
      },
    });
    expect(plan.actions.length).toBe(1);
    const action = plan.actions[0];
    if (action === undefined) throw new Error("expected one action");
    expect(action.kind).toBe("download-file");
    if (action.kind === "download-file") {
      expect(action.target).toBe(expectedRuntimePath);
      expect(action.category).toBe("runtime-file");
    }
  });
});
