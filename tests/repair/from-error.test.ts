import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApiEndpoints } from "../../src/constants/api";
import {
  isErrorCode,
  isMinecraftKitError,
  MinecraftKitError,
  MinecraftKitErrorCodes,
} from "../../src/core/errors";
import { silentLogger } from "../../src/core/logger";
import { targetPaths } from "../../src/core/paths";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { createMemoryCache } from "../../src/http/cache";
import { deriveRepairActionsFromError, planRepairFromError } from "../../src/repair/from-error";
import { TargetsApi } from "../../src/targets/index";
import type { ResolvedForgeLoader } from "../../src/types/forge";
import {
  type DownloadAction,
  DownloadCategories,
  type InstallAction,
  InstallActionKinds,
  type InstallPlan,
  type RunForgeProcessorAction,
  type WriteVersionJsonAction,
} from "../../src/types/install";
import { Loaders } from "../../src/types/loader";
import type { ResolvedMinecraft } from "../../src/types/minecraft";
import type { ResolvedRuntime } from "../../src/types/runtime";
import type { RuntimeSystem } from "../../src/types/system";
import type { Target } from "../../src/types/target";
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

const buildVanillaHttp = (): FakeHttpClient =>
  new FakeHttpClient()
    .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
    .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
    .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
    .on("https://idx/", { body: '{"objects":{}}' })
    .on("https://rm/", { body: '{"files":{}}' });

const buildVanillaTarget = async (http: FakeHttpClient): Promise<Target> => {
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
  });
};

const fakeMinecraft: ResolvedMinecraft = {
  version: asMinecraftVersionId("1.20.1"),
  channel: "release",
  manifest: {
    id: asMinecraftVersionId("1.20.1"),
    type: "release",
    mainClass: "x",
    assetIndex: { id: "5", sha1: "x", size: 1, totalSize: 1, url: "https://idx/" },
    assets: "5",
    downloads: { client: { sha1: "abc", size: 1, url: "https://c/" } },
    libraries: [],
    javaVersion: { component: "java-runtime-gamma", majorVersion: 17 },
  },
  summary: {
    id: asMinecraftVersionId("1.20.1"),
    type: "release",
    url: "https://m/1.20.1",
    time: "t",
    releaseTime: "r",
    sha1: "x",
    complianceLevel: 1,
  },
};

const fakeRuntime: ResolvedRuntime = {
  component: "java-runtime-gamma",
  platformKey: "windows-x64",
  versionName: "17.0.8",
  system,
  manifestUrl: "https://rm/",
  manifestSha1: "x",
};

const fakeForgeLoader: ResolvedForgeLoader = {
  type: Loaders.FORGE,
  minecraftVersion: "1.20.1",
  forgeVersion: "47.2.0",
  fullVersion: "1.20.1-forge-47.2.0",
  installerUrl: "https://forge/installer/",
};

const fakeForgeTarget: Target = {
  id: "forge-demo",
  directory: "/forge-root",
  minecraft: fakeMinecraft,
  loader: fakeForgeLoader,
  runtime: fakeRuntime,
};

const synthForgeInstallPlan = (actions: readonly InstallAction[]): InstallPlan => ({
  targetId: fakeForgeTarget.id,
  directory: fakeForgeTarget.directory,
  target: fakeForgeTarget,
  actions,
  totalActions: actions.length,
  totalBytes: actions.reduce((sum, a) => {
    if (a.kind === InstallActionKinds.DOWNLOAD_FILE) return sum + (a.expectedSize ?? 0);
    return sum;
  }, 0),
});

const download = (
  input: Partial<DownloadAction> & Pick<DownloadAction, "url" | "target" | "category">,
): DownloadAction => ({
  kind: InstallActionKinds.DOWNLOAD_FILE,
  ...input,
});

const writeVersionJson = (filePath: string): WriteVersionJsonAction => ({
  kind: InstallActionKinds.WRITE_VERSION_JSON,
  path: filePath,
  content: "{}",
});

const runProcessor = (index: number): RunForgeProcessorAction => ({
  kind: InstallActionKinds.RUN_FORGE_PROCESSOR,
  index,
  classpath: [`/forge-root/libraries/processor-${index}.jar`],
  args: ["--input", `/in-${index}`],
  outputs: {},
});

describe("deriveRepairActionsFromError", () => {
  it("matches an INTEGRITY_HASH_MISMATCH to a single download action by URL", () => {
    const installPlan = synthForgeInstallPlan([
      download({
        url: "https://lib/a.jar",
        target: "/forge-root/libraries/a.jar",
        category: DownloadCategories.LIBRARY,
        expectedSize: 100,
      }),
      download({
        url: "https://lib/b.jar",
        target: "/forge-root/libraries/b.jar",
        category: DownloadCategories.LIBRARY,
      }),
    ]);
    const error = new MinecraftKitError(
      MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH,
      "SHA-1 mismatch",
      { context: { url: "https://lib/a.jar", expectedHash: "x", actualHash: "y" } },
    );
    const actions = deriveRepairActionsFromError(error, installPlan);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe(InstallActionKinds.DOWNLOAD_FILE);
    if (actions[0]?.kind === InstallActionKinds.DOWNLOAD_FILE) {
      expect(actions[0].target).toBe("/forge-root/libraries/a.jar");
    }
  });

  it("matches an INTEGRITY_HASH_MISMATCH to any mirror URL on an action with multiple URLs", () => {
    const installPlan = synthForgeInstallPlan([
      download({
        url: ["https://primary/a.jar", "https://mirror/a.jar"],
        target: "/forge-root/libraries/a.jar",
        category: DownloadCategories.LIBRARY,
      }),
    ]);
    const error = new MinecraftKitError(
      MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH,
      "SHA-1 mismatch",
      { context: { url: "https://mirror/a.jar", expectedHash: "x", actualHash: "y" } },
    );
    const actions = deriveRepairActionsFromError(error, installPlan);
    expect(actions).toHaveLength(1);
  });

  it("matches a NETWORK_HTTP_ERROR mirror-exhausted error via its `urls` array", () => {
    const installPlan = synthForgeInstallPlan([
      download({
        url: ["https://primary/a.jar", "https://mirror/a.jar"],
        target: "/forge-root/libraries/a.jar",
        category: DownloadCategories.LIBRARY,
      }),
      download({
        url: "https://lib/b.jar",
        target: "/forge-root/libraries/b.jar",
        category: DownloadCategories.LIBRARY,
      }),
    ]);
    const error = new MinecraftKitError(
      MinecraftKitErrorCodes.NETWORK_HTTP_ERROR,
      "All mirrors failed",
      {
        context: {
          urls: ["https://primary/a.jar", "https://mirror/a.jar"],
          filePath: "/forge-root/libraries/a.jar",
        },
      },
    );
    const actions = deriveRepairActionsFromError(error, installPlan);
    expect(actions).toHaveLength(1);
    if (actions[0]?.kind === InstallActionKinds.DOWNLOAD_FILE) {
      expect(actions[0].target).toBe("/forge-root/libraries/a.jar");
    }
  });

  it("matches a FILESYSTEM_WRITE_ERROR raised on a WRITE_VERSION_JSON by filePath", () => {
    const forgeJsonPath = path.join(
      "/forge-root",
      "versions",
      "1.20.1-forge-47.2.0",
      "1.20.1-forge-47.2.0.json",
    );
    const installPlan = synthForgeInstallPlan([
      writeVersionJson(forgeJsonPath),
      download({
        url: "https://lib/a.jar",
        target: "/forge-root/libraries/a.jar",
        category: DownloadCategories.LIBRARY,
      }),
    ]);
    const error = new MinecraftKitError(
      MinecraftKitErrorCodes.FILESYSTEM_WRITE_ERROR,
      "atomicWrite failed",
      { context: { filePath: forgeJsonPath } },
    );
    const actions = deriveRepairActionsFromError(error, installPlan);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe(InstallActionKinds.WRITE_VERSION_JSON);
  });

  it("collects the entire forge processor stage for FORGE_PROCESSOR_FAILED", () => {
    const forgeJsonPath = targetPaths.versionJson(
      fakeForgeTarget.directory,
      fakeForgeLoader.fullVersion,
    );
    const installPlan = synthForgeInstallPlan([
      download({
        url: "https://c/",
        target: "/forge-root/versions/1.20.1/1.20.1.jar",
        category: DownloadCategories.CLIENT_JAR,
      }),
      writeVersionJson(path.join("/forge-root", "versions", "1.20.1", "1.20.1.json")),
      download({
        url: "https://forge/lib/a.jar",
        target: "/forge-root/libraries/forge-a.jar",
        category: DownloadCategories.FORGE_LIBRARY,
      }),
      download({
        url: "https://forge/lib/b.jar",
        target: "/forge-root/libraries/forge-b.jar",
        category: DownloadCategories.FORGE_LIBRARY,
      }),
      writeVersionJson(forgeJsonPath),
      runProcessor(0),
      runProcessor(1),
    ]);
    const error = new MinecraftKitError(
      MinecraftKitErrorCodes.FORGE_PROCESSOR_FAILED,
      "Processor crashed",
      {
        context: {
          mainClass: "net.minecraftforge.installer.SignTool",
          exitCode: 1,
          stderr: "boom",
        },
      },
    );
    const actions = deriveRepairActionsFromError(error, installPlan);

    const kinds = actions.map((a) => a.kind).sort();
    expect(kinds).toEqual(
      [
        InstallActionKinds.DOWNLOAD_FILE,
        InstallActionKinds.DOWNLOAD_FILE,
        InstallActionKinds.RUN_FORGE_PROCESSOR,
        InstallActionKinds.RUN_FORGE_PROCESSOR,
        InstallActionKinds.WRITE_VERSION_JSON,
      ].sort(),
    );

    const downloadCategories = actions
      .filter((a): a is DownloadAction => a.kind === InstallActionKinds.DOWNLOAD_FILE)
      .map((a) => a.category)
      .sort();
    expect(downloadCategories).toEqual([
      DownloadCategories.FORGE_LIBRARY,
      DownloadCategories.FORGE_LIBRARY,
    ]);

    const writes = actions.filter(
      (a): a is WriteVersionJsonAction => a.kind === InstallActionKinds.WRITE_VERSION_JSON,
    );
    expect(writes.map((a) => a.path)).toEqual([forgeJsonPath]);
  });
});

describe("planRepairFromError (end-to-end)", () => {
  it("produces a single-action repair plan for INTEGRITY_HASH_MISMATCH on the client jar", async () => {
    const http = buildVanillaHttp();
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http);
    const error = new MinecraftKitError(
      MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH,
      "SHA-1 mismatch",
      { context: { url: "https://c/", expectedHash: "abc", actualHash: "xyz" } },
    );
    const plan = await planRepairFromError({ error, target, http, cache });
    expect(plan.totalActions).toBe(1);
    expect(plan.targetId).toBe(target.id);
    const first = plan.actions[0];
    expect(first?.kind).toBe(InstallActionKinds.DOWNLOAD_FILE);
    if (first?.kind === InstallActionKinds.DOWNLOAD_FILE) {
      expect(first.category).toBe(DownloadCategories.CLIENT_JAR);
    }
  });

  it("throws INVALID_INPUT for a code outside the supported set", async () => {
    const http = buildVanillaHttp();
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http);
    const error = new MinecraftKitError(
      MinecraftKitErrorCodes.LAUNCH_PROCESS_FAILED,
      "Minecraft exited non-zero",
      { context: { exitCode: 1 } },
    );
    let thrown: unknown;
    try {
      await planRepairFromError({ error, target, http, cache });
    } catch (caught) {
      thrown = caught;
    }
    expect(isMinecraftKitError(thrown)).toBe(true);
    if (isErrorCode(thrown, MinecraftKitErrorCodes.INVALID_INPUT)) {
      expect(thrown.message).toContain("LAUNCH_PROCESS_FAILED");
    } else {
      throw new Error("expected INVALID_INPUT");
    }
  });

  it("throws INVALID_INPUT when the error context does not match any install action", async () => {
    const http = buildVanillaHttp();
    const cache = createMemoryCache();
    const target = await buildVanillaTarget(http);
    const error = new MinecraftKitError(
      MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH,
      "SHA-1 mismatch",
      { context: { url: "https://nowhere/", expectedHash: "x", actualHash: "y" } },
    );
    await expect(planRepairFromError({ error, target, http, cache })).rejects.toMatchObject({
      code: MinecraftKitErrorCodes.INVALID_INPUT,
    });
  });
});
