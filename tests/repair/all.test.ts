import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../../src/core/errors";
import { targetPaths } from "../../src/core/paths";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { createMemoryCache } from "../../src/http/cache";
import { repairAll } from "../../src/repair/all";
import { EventTypes, type ProgressEvent } from "../../src/types/events";
import { Loaders } from "../../src/types/loader";
import type { Target } from "../../src/types/target";
import { VerificationKinds, VerifyFileCategories } from "../../src/types/verify";
import { FakeHttpClient } from "../helpers/fake-http";
import { FakeSpawner } from "../helpers/fake-spawner";
import { sha1OfBytes } from "../helpers/hash";

const textSize = (value: string): number => new TextEncoder().encode(value).byteLength;
const ASSET_INDEX_BODY = '{"objects":{}}';
const RUNTIME_BODY = "java";

const buildRepairTarget = (directory: string): Target => {
  const version = asMinecraftVersionId("1.20.1");
  const clientBody = "client";
  const minecraft: Target["minecraft"] = {
    version,
    channel: "release",
    manifest: {
      id: version,
      type: "release",
      mainClass: "net.minecraft.client.main.Main",
      assetIndex: {
        id: "5",
        sha1: sha1OfBytes(ASSET_INDEX_BODY),
        size: textSize(ASSET_INDEX_BODY),
        totalSize: textSize(ASSET_INDEX_BODY),
        url: "https://idx/",
      },
      assets: "5",
      downloads: {
        client: {
          sha1: sha1OfBytes(clientBody),
          size: textSize(clientBody),
          url: "https://client/",
        },
      },
      libraries: [],
      javaVersion: { component: "java-runtime-gamma", majorVersion: 17 },
    },
    summary: {
      id: version,
      type: "release",
      url: "https://version/",
      time: "2024-01-01T00:00:00+00:00",
      releaseTime: "2024-01-01T00:00:00+00:00",
      sha1: "version-sha1",
      complianceLevel: 1,
    },
  };
  return {
    id: "repair-all",
    directory,
    minecraft,
    loader: { type: Loaders.VANILLA, minecraftVersion: version, minecraft },
    runtime: {
      component: "java-runtime-gamma",
      platformKey: "windows-x64",
      versionName: "17.0.8",
      majorVersion: 17,
      system: { os: "windows", arch: "x64", osVersion: "10.0" },
      manifestUrl: "https://runtime-manifest/",
      manifestSha1: "runtime-manifest-sha1",
    },
  };
};

const createRepairHttp = (runtimeBody = RUNTIME_BODY): FakeHttpClient => {
  const runtimeManifest = {
    files: {
      "bin/javaw.exe": {
        type: "file",
        executable: true,
        downloads: {
          raw: {
            sha1: sha1OfBytes(runtimeBody),
            size: textSize(runtimeBody),
            url: "https://runtime/javaw",
          },
        },
      },
    },
  };
  return new FakeHttpClient()
    .on("https://idx/", { body: ASSET_INDEX_BODY })
    .on("https://client/", { body: "client" })
    .on("https://runtime-manifest/", { body: JSON.stringify(runtimeManifest) })
    .on("https://runtime/javaw", { body: runtimeBody });
};

const writeExistingAssetIndex = async (root: string): Promise<void> => {
  await mkdir(path.dirname(targetPaths.assetIndex(root, "5")), { recursive: true });
  await writeFile(targetPaths.assetIndex(root, "5"), ASSET_INDEX_BODY);
};

const writeExistingVersionJson = async (target: Target): Promise<void> => {
  const versionJsonPath = targetPaths.versionJson(target.directory, target.minecraft.version);
  await mkdir(path.dirname(versionJsonPath), { recursive: true });
  await writeFile(versionJsonPath, JSON.stringify(target.minecraft.manifest));
};

describe("repairAll progress events", () => {
  it("forwards verification events and annotates repair events with their aspect", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mckit-repair-all-"));
    try {
      const target = buildRepairTarget(root);
      await writeExistingAssetIndex(root);

      const http = createRepairHttp();
      const events: ProgressEvent[] = [];

      const report = await repairAll({
        target,
        http,
        cache: createMemoryCache(),
        spawner: new FakeSpawner(),
        onEvent: (event) => events.push(event),
      });

      const runtimePath = path.join(root, "runtime", "java-runtime-gamma", "bin", "javaw.exe");
      expect([...report.repairs.keys()]).toEqual([
        VerificationKinds.MINECRAFT,
        VerificationKinds.RUNTIME,
      ]);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: EventTypes.VERIFY_FILE_CHECKED,
            aspect: VerificationKinds.MINECRAFT,
            file: expect.objectContaining({ category: VerifyFileCategories.CLIENT_JAR }),
          }),
          expect.objectContaining({
            type: EventTypes.VERIFY_FILE_CHECKED,
            aspect: VerificationKinds.RUNTIME,
            file: expect.objectContaining({ category: VerifyFileCategories.RUNTIME_FILE }),
          }),
          expect.objectContaining({
            type: EventTypes.DOWNLOAD_STARTED,
            aspect: VerificationKinds.MINECRAFT,
            file: expect.objectContaining({ target: targetPaths.versionJar(root, "1.20.1") }),
          }),
          expect.objectContaining({
            type: EventTypes.DOWNLOAD_STARTED,
            aspect: VerificationKinds.RUNTIME,
            file: expect.objectContaining({ target: runtimePath }),
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips caller-owned Minecraft issues before planning repairs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mckit-repair-all-filter-"));
    try {
      const target = buildRepairTarget(root);
      await writeExistingAssetIndex(root);
      await writeExistingVersionJson(target);
      const clientJarPath = targetPaths.versionJar(root, "1.20.1");
      const runtimePath = path.join(root, "runtime", "java-runtime-gamma", "bin", "javaw.exe");

      const report = await repairAll({
        target,
        http: createRepairHttp(),
        cache: createMemoryCache(),
        spawner: new FakeSpawner(),
        shouldRepairIssue: ({ issue }) => issue.path !== clientJarPath,
      });

      expect(
        report.verifications.find((result) => result.kind === VerificationKinds.MINECRAFT),
      ).toMatchObject({
        isValid: true,
        issues: [],
      });
      expect([...report.repairs.keys()]).toEqual([VerificationKinds.RUNTIME]);
      await expect(access(clientJarPath)).rejects.toThrow();
      await expect(access(runtimePath)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips caller-owned runtime issues before planning repairs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mckit-repair-all-filter-"));
    try {
      const target = buildRepairTarget(root);
      await writeExistingAssetIndex(root);
      await writeExistingVersionJson(target);
      const clientJarPath = targetPaths.versionJar(root, "1.20.1");
      const runtimePath = path.join(root, "runtime", "java-runtime-gamma", "bin", "javaw.exe");

      const report = await repairAll({
        target,
        http: createRepairHttp(),
        cache: createMemoryCache(),
        spawner: new FakeSpawner(),
        shouldRepairIssue: ({ issue }) => issue.path !== runtimePath,
      });

      expect(
        report.verifications.find((result) => result.kind === VerificationKinds.RUNTIME),
      ).toMatchObject({
        isValid: true,
        issues: [],
      });
      expect([...report.repairs.keys()]).toEqual([VerificationKinds.MINECRAFT]);
      await expect(access(clientJarPath)).resolves.toBeUndefined();
      await expect(access(runtimePath)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("repairAll offline tolerance", () => {
  it("reports aspects whose repair needs the network as blocked instead of rejecting", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mckit-repair-all-offline-"));
    try {
      const target = buildRepairTarget(root);
      const offlineHttp = new FakeHttpClient()
        .on("https://idx/", {
          error: () =>
            new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_HTTP_ERROR, "offline: idx"),
        })
        .on("https://runtime-manifest/", {
          error: () =>
            new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_HTTP_ERROR, "offline: rt"),
        });

      const report = await repairAll({
        target,
        http: offlineHttp,
        cache: createMemoryCache(),
        spawner: new FakeSpawner(),
      });

      expect(report.repairs.size).toBe(0);
      expect([...report.blockedAspects.keys()].sort()).toEqual(
        [VerificationKinds.MINECRAFT, VerificationKinds.RUNTIME].sort(),
      );
      expect(report.blockedAspects.get(VerificationKinds.MINECRAFT)?.code).toBe(
        MinecraftKitErrorCodes.NETWORK_HTTP_ERROR,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
