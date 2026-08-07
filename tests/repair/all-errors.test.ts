import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../../src/core/errors";
import { targetPaths } from "../../src/core/paths";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { createMemoryCache } from "../../src/http/cache";
import { repairAll } from "../../src/repair/all";
import { Loaders } from "../../src/types/loader";
import type { Target } from "../../src/types/target";
import { VerificationKinds } from "../../src/types/verify";
import { FakeHttpClient } from "../helpers/fake-http";
import { FakeSpawner } from "../helpers/fake-spawner";
import { sha1OfBytes } from "../helpers/hash";

const ASSET_INDEX_BODY = '{"objects":{}}';
const CLIENT_BODY = "client";
const RUNTIME_BODY = "java";
const textSize = (value: string): number => new TextEncoder().encode(value).byteLength;

const buildTarget = (directory: string): Target => {
  const version = asMinecraftVersionId("1.20.1");
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
          sha1: sha1OfBytes(CLIENT_BODY),
          size: textSize(CLIENT_BODY),
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
    id: "repair-all-errors",
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

const runtimeManifest = JSON.stringify({
  files: {
    "bin/javaw.exe": {
      type: "file",
      executable: true,
      downloads: {
        raw: {
          sha1: sha1OfBytes(RUNTIME_BODY),
          size: textSize(RUNTIME_BODY),
          url: "https://runtime/javaw",
        },
      },
    },
  },
});

const healthyHttp = (): FakeHttpClient =>
  new FakeHttpClient()
    .on("https://idx/", { body: ASSET_INDEX_BODY })
    .on("https://client/", { body: CLIENT_BODY })
    .on("https://runtime-manifest/", { body: runtimeManifest })
    .on("https://runtime/javaw", { body: RUNTIME_BODY });

const roots: string[] = [];
const makeRoot = async (label: string): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), `mckit-${label}-`));
  roots.push(root);
  return root;
};

const seedAssetIndex = async (root: string): Promise<void> => {
  const indexPath = targetPaths.assetIndex(root, "5");
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, ASSET_INDEX_BODY);
};

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("repairAll error propagation", () => {
  // A malformed manifest is not "offline": degrading it to a blocked aspect would silently
  // report a half-repaired install as "needs the network", hiding a corrupt upstream payload.
  it("rethrows a non-connectivity planning failure instead of blocking the aspect", async () => {
    const root = await makeRoot("repair-all-plan-bad");
    const target = buildTarget(root);
    const http = healthyHttp().on("https://idx/", {
      error: () =>
        new MinecraftKitError(
          MinecraftKitErrorCodes.MANIFEST_INVALID,
          "asset index is not an index",
        ),
    });

    const failure = await repairAll({
      target,
      http,
      cache: createMemoryCache(),
      spawner: new FakeSpawner(),
    }).catch((error: unknown) => error);

    expect((failure as MinecraftKitError).code).toBe(MinecraftKitErrorCodes.MANIFEST_INVALID);
  });

  // Offline tolerance must not swallow the abort: once the caller cancelled, even a
  // connectivity error has to reject rather than be recorded as "this aspect needs the network",
  // which would make a cancelled Repair look like a successful partial one.
  it("rethrows a connectivity failure raised after the caller aborted", async () => {
    const root = await makeRoot("repair-all-aborted");
    const target = buildTarget(root);
    const controller = new AbortController();
    const http = healthyHttp().on("https://idx/", {
      error: () => new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_TIMEOUT, "idx stalled"),
    });

    const failure = await repairAll({
      target,
      http,
      cache: createMemoryCache(),
      spawner: new FakeSpawner(),
      signal: controller.signal,
      // Runs after verification, before the shared plan is built.
      shouldRepairIssue: () => {
        controller.abort();
        return true;
      },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MinecraftKitError);
    expect((failure as MinecraftKitError).code).toBe(MinecraftKitErrorCodes.NETWORK_TIMEOUT);
  });

  it("blocks only the aspect whose repair run lost the network", async () => {
    const root = await makeRoot("repair-all-run-blocked");
    const target = buildTarget(root);
    await seedAssetIndex(root);
    // Planning sees a healthy client URL; the download itself then fails. Only `minecraft` may
    // end up blocked — the runtime aspect must still be repaired from the same shared plan.
    let clientRequests = 0;
    const http = healthyHttp().on("https://client/", {
      error: () => {
        clientRequests += 1;
        return new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_TIMEOUT, "client stalled");
      },
    });
    // `downloadFile` re-wraps a per-attempt failure once its retries are exhausted, so the
    // blocker the report carries is the download layer's NETWORK_HTTP_ERROR.

    const report = await repairAll({
      target,
      http,
      cache: createMemoryCache(),
      spawner: new FakeSpawner(),
    });

    expect(clientRequests).toBeGreaterThan(0);
    expect([...report.blockedAspects.keys()]).toEqual([VerificationKinds.MINECRAFT]);
    expect(report.blockedAspects.get(VerificationKinds.MINECRAFT)?.code).toBe(
      MinecraftKitErrorCodes.NETWORK_HTTP_ERROR,
    );
    expect([...report.repairs.keys()]).toEqual([VerificationKinds.RUNTIME]);
    expect(report.installPlan).not.toBeNull();
  });

  it("skips an aspect whose filtered plan has no actions left", async () => {
    const root = await makeRoot("repair-all-empty-plan");
    const target = buildTarget(root);
    await seedAssetIndex(root);

    // Report the runtime aspect broken but veto its only issue: its plan filters down to zero
    // actions, so it must be neither repaired nor blocked — and must not appear in `repairs`
    // with a no-op report.
    const runtimeFile = path.join(root, "runtime", "java-runtime-gamma", "bin", "javaw.exe");
    const report = await repairAll({
      target,
      http: healthyHttp(),
      cache: createMemoryCache(),
      spawner: new FakeSpawner(),
      shouldRepairIssue: ({ issue }) => issue.path !== runtimeFile,
    });

    expect([...report.repairs.keys()]).toEqual([VerificationKinds.MINECRAFT]);
    expect(report.blockedAspects.size).toBe(0);
  });

  it("counts bytes across every repaired aspect", async () => {
    const root = await makeRoot("repair-all-bytes");
    const target = buildTarget(root);
    await seedAssetIndex(root);

    const report = await repairAll({
      target,
      http: healthyHttp(),
      cache: createMemoryCache(),
      spawner: new FakeSpawner(),
    });

    const expected = [...report.repairs.values()].reduce(
      (sum, aspect) => sum + aspect.bytesDownloaded,
      0,
    );
    expect(report.bytesDownloaded).toBe(expected);
    expect(report.bytesDownloaded).toBeGreaterThan(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });
});
