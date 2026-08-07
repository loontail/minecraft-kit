import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiEndpoints } from "../../src/constants/api";
import { silentLogger } from "../../src/core/logger";
import { targetPaths } from "../../src/core/paths";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { createMemoryCache } from "../../src/http/cache";
import { verifyAndRepair } from "../../src/repair/verify-and-repair";
import { TargetsApi } from "../../src/targets/index";
import { Loaders } from "../../src/types/loader";
import { RepairModes } from "../../src/types/repair";
import type { Spawner } from "../../src/types/spawner";
import type { RuntimeSystem } from "../../src/types/system";
import type { Target } from "../../src/types/target";
import { type VerificationKind, VerificationKinds } from "../../src/types/verify";
import { FabricVersionsApi } from "../../src/versions/fabric";
import { ForgeVersionsApi } from "../../src/versions/forge";
import { MinecraftVersionsApi } from "../../src/versions/minecraft";
import { RuntimeVersionsApi } from "../../src/versions/runtime";
import { FakeHttpClient } from "../helpers/fake-http";
import { sha1OfBytes } from "../helpers/hash";

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

const unusedSpawner: Spawner = {
  spawn() {
    throw new Error("spawner unused in this suite");
  },
};

const seedCommonResponses = (http: FakeHttpClient): FakeHttpClient =>
  http
    .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
    .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
    .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
    .on("https://idx/", { body: '{"objects":{}}' });

const buildEmptyRuntimeHttp = (): FakeHttpClient =>
  seedCommonResponses(new FakeHttpClient()).on("https://rm/", { body: '{"files":{}}' });

const buildSingleFileRuntimeHttp = (relative: string, body: Uint8Array): FakeHttpClient => {
  const runtimeManifest = {
    files: {
      [relative]: {
        type: "file",
        executable: false,
        downloads: {
          raw: { sha1: sha1OfBytes(body), size: body.byteLength, url: "https://rt/file" },
        },
      },
    },
  };
  return seedCommonResponses(new FakeHttpClient())
    .on("https://rm/", { body: JSON.stringify(runtimeManifest) })
    .on("https://rt/file", { body });
};

const resolveVanillaTarget = async (http: FakeHttpClient, directory: string): Promise<Target> => {
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
    directory,
    minecraft: { version: asMinecraftVersionId("1.20.1") },
    loader: { type: Loaders.VANILLA },
  });
};

describe("verifyAndRepair", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-runverify-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("mode='report' on a clean runtime target reports valid and never touches disk", async () => {
    const http = buildEmptyRuntimeHttp();
    const cache = createMemoryCache();
    const target = await resolveVanillaTarget(http, tmpDir);
    const result = await verifyAndRepair(
      { http, cache, spawner: unusedSpawner },
      { aspect: VerificationKinds.RUNTIME, target, mode: RepairModes.REPORT },
    );
    expect(result.verification.isValid).toBe(true);
    expect(result.repair).toBeNull();
  });

  it("mode='fix' on a clean runtime target returns repair: null without running install", async () => {
    const http = buildEmptyRuntimeHttp();
    const cache = createMemoryCache();
    const target = await resolveVanillaTarget(http, tmpDir);
    const result = await verifyAndRepair(
      { http, cache, spawner: unusedSpawner },
      { aspect: VerificationKinds.RUNTIME, target },
    );
    expect(result.verification.isValid).toBe(true);
    expect(result.repair).toBeNull();
  });

  it("mode='fix' on a broken runtime target downloads the missing file and reports the repair", async () => {
    const body = new TextEncoder().encode("hello-runtime-byte-stream");
    const http = buildSingleFileRuntimeHttp("bin/java", body);
    const cache = createMemoryCache();
    const target = await resolveVanillaTarget(http, tmpDir);
    const expectedPath = path.join(
      targetPaths.runtimeRoot(tmpDir, "java-runtime-gamma"),
      "bin",
      "java",
    );
    const result = await verifyAndRepair(
      { http, cache, spawner: unusedSpawner },
      { aspect: VerificationKinds.RUNTIME, target },
    );
    expect(result.verification.isValid).toBe(false);
    expect(result.verification.issues.map((issue) => issue.path)).toContain(expectedPath);
    expect(result.repair).not.toBeNull();
    if (result.repair !== null) {
      expect(result.repair.bytesDownloaded).toBe(body.byteLength);
      expect(result.repair.actionsCompleted).toBeGreaterThanOrEqual(1);
    }
    const onDisk = await fs.readFile(expectedPath);
    expect(onDisk.byteLength).toBe(body.byteLength);
  });

  it("mode='report' on a broken runtime target reports issues but leaves disk untouched", async () => {
    const body = new TextEncoder().encode("hello-runtime-byte-stream");
    const http = buildSingleFileRuntimeHttp("bin/java", body);
    const cache = createMemoryCache();
    const target = await resolveVanillaTarget(http, tmpDir);
    const expectedPath = path.join(
      targetPaths.runtimeRoot(tmpDir, "java-runtime-gamma"),
      "bin",
      "java",
    );
    const result = await verifyAndRepair(
      { http, cache, spawner: unusedSpawner },
      { aspect: VerificationKinds.RUNTIME, target, mode: RepairModes.REPORT },
    );
    expect(result.verification.isValid).toBe(false);
    expect(result.verification.issues.map((issue) => issue.path)).toContain(expectedPath);
    expect(result.repair).toBeNull();
    await expect(fs.access(expectedPath)).rejects.toThrow();
  });

  it("throws INVALID_INPUT for an unknown aspect", async () => {
    const http = buildEmptyRuntimeHttp();
    const cache = createMemoryCache();
    const target = await resolveVanillaTarget(http, tmpDir);
    await expect(
      verifyAndRepair(
        { http, cache, spawner: unusedSpawner },
        { aspect: "bogus" as unknown as VerificationKind, target },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
