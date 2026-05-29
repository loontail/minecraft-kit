import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiEndpoints } from "../../src/constants/api";
import { silentLogger } from "../../src/core/logger";
import { targetPaths } from "../../src/core/paths";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { createMemoryCache } from "../../src/http/cache";
import { MinecraftKit } from "../../src/kit";
import { TargetsApi } from "../../src/targets/index";
import { Loaders } from "../../src/types/loader";
import type { RuntimeSystem } from "../../src/types/system";
import { VerificationKinds, VerifyFileCategories } from "../../src/types/verify";
import { verifyFabric } from "../../src/verify/fabric";
import { verifyForge } from "../../src/verify/forge";
import { verifyMinecraft } from "../../src/verify/minecraft";
import { verifyRuntime } from "../../src/verify/runtime";
import { FabricVersionsApi } from "../../src/versions/fabric";
import { ForgeVersionsApi } from "../../src/versions/forge";
import { MinecraftVersionsApi } from "../../src/versions/minecraft";
import { RuntimeVersionsApi } from "../../src/versions/runtime";
import { FakeHttpClient } from "../helpers/fake-http";

const system: RuntimeSystem = { os: "windows", arch: "x64", osVersion: "10.0" };

afterEach(() => {
  vi.restoreAllMocks();
});

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
const fabricCompat = [
  {
    loader: { version: "0.14.21", stable: true, maven: "x", build: 0, separator: "." },
    intermediary: { version: "1", maven: "x", stable: true },
  },
];
const fabricProfile = {
  id: "fabric-loader-0.14.21-1.20.1",
  inheritsFrom: "1.20.1",
  type: "release",
  mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
  libraries: [],
};

const buildKit = (http: FakeHttpClient): MinecraftKit =>
  new MinecraftKit({
    httpClient: http,
    cache: createMemoryCache(),
    logger: silentLogger,
    system,
  });

const buildVanillaTarget = (
  http: FakeHttpClient,
  opts: { directory?: string; runtimeInstallRoot?: string } = {},
) => {
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
    directory: opts.directory ?? "/r",
    minecraft: { version: asMinecraftVersionId("1.20.1") },
    loader: { type: Loaders.VANILLA },
    ...(opts.runtimeInstallRoot !== undefined
      ? { runtime: { installRoot: opts.runtimeInstallRoot } }
      : {}),
  });
};

const buildFabricTarget = (kit: MinecraftKit) =>
  kit.targets.resolve({
    id: "fabric",
    directory: "/fabric-root",
    minecraft: { version: asMinecraftVersionId("1.20.1") },
    loader: { type: Loaders.FABRIC, version: "0.14.21" },
  });

const baseHttp = (): FakeHttpClient =>
  new FakeHttpClient()
    .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
    .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
    .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
    .on("https://idx/", { body: '{"objects":{}}' });

describe("verifyMinecraft", () => {
  it("emits kind: 'minecraft' and reports missing client jar as an issue", async () => {
    const http = new FakeHttpClient()
      .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
      .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
      .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
      .on("https://idx/", { body: '{"objects":{}}' })
      .on("https://rm/", { body: '{"files":{}}' });
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http);
    const result = await verifyMinecraft({ target, http, cache });
    expect(result.kind).toBe(VerificationKinds.MINECRAFT);
    expect(result.isValid).toBe(false);
    const clientJarIssue = result.issues.find((i) => i.category === "client-jar");
    expect(clientJarIssue?.path).toBe(path.join("/r", "versions", "1.20.1", "1.20.1.jar"));
  });

  it("records a missing asset-index issue and does not throw when the index fetch fails", async () => {
    const http = new FakeHttpClient()
      .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
      .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
      .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
      .on("https://idx/", { error: () => new Error("offline") });
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http);
    const result = await verifyMinecraft({ target, http, cache });
    expect(result.isValid).toBe(false);
    const indexIssue = result.issues.find(
      (i) => i.category === VerifyFileCategories.ASSET_INDEX && i.path === "https://idx/",
    );
    expect(indexIssue?.status).toBe("missing");
  });

  it("reports a malformed asset index as an issue instead of trusting it as valid", async () => {
    const http = new FakeHttpClient()
      .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
      .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
      .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
      .on("https://idx/", { body: '{"not":"an-asset-index"}' });
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http);
    const result = await verifyMinecraft({ target, http, cache });
    const indexIssue = result.issues.find(
      (i) => i.category === VerifyFileCategories.ASSET_INDEX && i.path === "https://idx/",
    );
    expect(indexIssue?.status).toBe("missing");
  });
});

describe("kit.verify.targetReady", () => {
  it("reports a vanilla target without a client jar as not ready", async () => {
    const http = baseHttp().on("https://rm/", { body: '{"files":{}}' });
    const kit = buildKit(http);
    const target = await kit.targets.resolve({
      id: "vanilla",
      directory: "/vanilla-root",
      minecraft: { version: asMinecraftVersionId("1.20.1") },
      loader: { type: Loaders.VANILLA },
    });

    const readiness = await kit.verify.targetReady.run(target);

    expect(readiness.isReady).toBe(false);
    expect(readiness.verifications.map((result) => result.kind)).toEqual([
      VerificationKinds.MINECRAFT,
      VerificationKinds.RUNTIME,
    ]);
    expect(readiness.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: VerificationKinds.MINECRAFT,
          category: VerifyFileCategories.CLIENT_JAR,
          path: targetPaths.versionJar("/vanilla-root", "1.20.1"),
        }),
      ]),
    );
  });

  it("reports missing Java runtime files as runtime readiness issues", async () => {
    const http = baseHttp().on("https://rm/", {
      body: JSON.stringify({
        files: {
          "bin/javaw.exe": {
            type: "file",
            executable: true,
            downloads: { raw: { sha1: "deadbeef", size: 100, url: "https://rt/javaw" } },
          },
        },
      }),
    });
    const kit = buildKit(http);
    const target = await kit.targets.resolve({
      id: "runtime-missing",
      directory: "/runtime-root",
      minecraft: { version: asMinecraftVersionId("1.20.1") },
      loader: { type: Loaders.VANILLA },
    });

    const readiness = await kit.verify.targetReady.run(target);

    expect(readiness.isReady).toBe(false);
    expect(readiness.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: VerificationKinds.RUNTIME,
          category: VerifyFileCategories.RUNTIME_FILE,
          path: path.join("/runtime-root", "runtime", "java-runtime-gamma", "bin", "javaw.exe"),
        }),
      ]),
    );
  });

  it("includes loader verification for loader targets", async () => {
    const http = baseHttp()
      .on("https://rm/", { body: '{"files":{}}' })
      .on(ApiEndpoints.fabric.loaderForGame("1.20.1"), { body: JSON.stringify(fabricCompat) })
      .on(ApiEndpoints.fabric.profile("1.20.1", "0.14.21"), {
        body: JSON.stringify(fabricProfile),
      });
    const kit = buildKit(http);
    const target = await buildFabricTarget(kit);

    const readiness = await kit.verify.targetReady.run(target);

    expect(readiness.isReady).toBe(false);
    expect(readiness.verifications.map((result) => result.kind)).toEqual([
      VerificationKinds.MINECRAFT,
      VerificationKinds.RUNTIME,
      VerificationKinds.FABRIC,
    ]);
    expect(readiness.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: VerificationKinds.FABRIC,
          category: VerifyFileCategories.LOADER_LIBRARY,
          path: targetPaths.versionJson("/fabric-root", fabricProfile.id),
        }),
      ]),
    );
  });
});

describe("verifyFabric", () => {
  it("rejects non-Fabric targets", async () => {
    const http = new FakeHttpClient()
      .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
      .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
      .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) });
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http);
    await expect(verifyFabric({ target, http, cache })).rejects.toThrow(/requires a Fabric target/);
  });
});

describe("verifyForge", () => {
  it("rejects non-Forge targets", async () => {
    const http = new FakeHttpClient()
      .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
      .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
      .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) });
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http);
    await expect(verifyForge({ target, http, cache })).rejects.toThrow(/requires a Forge target/);
  });
});

describe("verifyRuntime with installRoot", () => {
  it("checks runtime files under target.runtime.installRoot when set", async () => {
    const customInstallRoot = "/global-runtimes";
    const http = new FakeHttpClient()
      .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
      .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
      .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
      .on("https://rm/", {
        body: JSON.stringify({
          files: {
            "bin/javaw.exe": {
              type: "file",
              executable: true,
              downloads: { raw: { sha1: "deadbeef", size: 100, url: "https://rt/javaw" } },
            },
          },
        }),
      });
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http, { runtimeInstallRoot: customInstallRoot });
    expect(target.runtime.installRoot).toBe(customInstallRoot);
    const result = await verifyRuntime({ target, http, cache });
    expect(result.kind).toBe(VerificationKinds.RUNTIME);
    const expectedPath = path.join(customInstallRoot, "java-runtime-gamma", "bin", "javaw.exe");
    const issue = result.issues.find((i) => i.path === expectedPath);
    expect(issue).toBeDefined();
    expect(issue?.status).toBe("missing");
  });

  it("falls back to <directory>/runtime when installRoot is unset", async () => {
    const http = new FakeHttpClient()
      .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
      .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
      .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
      .on("https://rm/", {
        body: JSON.stringify({
          files: {
            "bin/javaw.exe": {
              type: "file",
              executable: true,
              downloads: { raw: { sha1: "deadbeef", size: 100, url: "https://rt/javaw" } },
            },
          },
        }),
      });
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http);
    expect(target.runtime.installRoot).toBeUndefined();
    const result = await verifyRuntime({ target, http, cache });
    const expectedPath = path.join("/r", "runtime", "java-runtime-gamma", "bin", "javaw.exe");
    expect(result.issues.find((i) => i.path === expectedPath)).toBeDefined();
  });

  it("records the manifest as unreachable when it returns an unrecognisable shape", async () => {
    const http = new FakeHttpClient()
      .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
      .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
      .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
      .on("https://rm/", { body: '{"not":"a-runtime-manifest"}' });
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http);
    const result = await verifyRuntime({ target, http, cache });
    expect(result.kind).toBe(VerificationKinds.RUNTIME);
    const manifestIssue = result.issues.find((i) => i.path === "https://rm/");
    expect(manifestIssue?.status).toBe("missing");
    expect(manifestIssue?.category).toBe(VerifyFileCategories.RUNTIME_FILE);
  });
});
