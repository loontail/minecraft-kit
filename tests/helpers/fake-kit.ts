import type { MinecraftKit } from "../../src/kit";
import type { FabricLoaderSummary } from "../../src/types/fabric";
import type { ForgeBuildSummary } from "../../src/types/forge";
import type { InstallPlan, InstallReport } from "../../src/types/install";
import type { LaunchComposition, LaunchExit, LaunchSession } from "../../src/types/launch";
import type { Loader, Loaders } from "../../src/types/loader";
import type { MinecraftVersionSummary, ResolvedMinecraft } from "../../src/types/minecraft";
import type { RepairPlan, RepairReport } from "../../src/types/repair";
import type { ResolvedRuntime } from "../../src/types/runtime";
import type { DiscoveredTarget, Target } from "../../src/types/target";
import type { VerificationResult } from "../../src/types/verify";

const fakeMinecraft: ResolvedMinecraft = {
  version: "1.20.1",
  channel: "release",
  manifest: {
    id: "1.20.1",
    type: "release",
    mainClass: "net.minecraft.client.main.Main",
    assetIndex: { id: "5", sha1: "x", size: 1, totalSize: 1, url: "https://idx/" },
    assets: "5",
    downloads: { client: { sha1: "x", size: 1, url: "https://c/" } },
    libraries: [],
    javaVersion: { component: "java-runtime-gamma", majorVersion: 17 },
  },
  summary: {
    id: "1.20.1",
    type: "release",
    url: "https://m/",
    time: "t",
    releaseTime: "2023-06-01T00:00:00+00:00",
    sha1: "x",
    complianceLevel: 1,
  },
};

const fakeRuntime: ResolvedRuntime = {
  component: "java-runtime-gamma",
  platformKey: "windows-x64",
  versionName: "17.0.8",
  system: { os: "windows", arch: "x64", osVersion: "10" },
  manifestUrl: "https://rm/",
  manifestSha1: "x",
};

const fakeVanillaLoader: Loader = {
  type: "vanilla" as typeof Loaders.VANILLA,
  minecraftVersion: "1.20.1",
  minecraft: fakeMinecraft,
};

/** Test fixture for vanilla target. */
export const fakeTarget: Target = {
  id: "demo",
  directory: "/tmp/demo",
  minecraft: fakeMinecraft,
  loader: fakeVanillaLoader,
  runtime: fakeRuntime,
};

type FakeKitInput = {
  readonly minecraftVersions?: readonly MinecraftVersionSummary[];
  readonly fabricLoaders?:
    | readonly FabricLoaderSummary[]
    | (() => Promise<readonly FabricLoaderSummary[]>);
  readonly forgeBuilds?:
    | readonly ForgeBuildSummary[]
    | (() => Promise<readonly ForgeBuildSummary[]>);
  readonly resolvedTarget?: Target;
  readonly resolveError?: unknown;
  readonly listResult?: readonly DiscoveredTarget[];
  readonly verificationResult?: VerificationResult;
  readonly composition?: LaunchComposition;
  readonly launchExit?: LaunchExit;
  readonly installError?: unknown;
  readonly runtimeList?: readonly { component: string; versionName: string }[];
};

/**
 * Build a minimal {@link MinecraftKit} stand-in for scenario tests. Only the methods
 * actually called by the scenarios are implemented; the cast to `MinecraftKit` is fine
 * because scenarios consume the public surface only.
 */
export const buildFakeKit = (input: FakeKitInput = {}): MinecraftKit => {
  const minecraftVersions =
    input.minecraftVersions ??
    ([
      {
        id: "1.20.1",
        type: "release",
        url: "https://m/",
        time: "",
        releaseTime: "2023-06-01T00:00:00+00:00",
        sha1: "x",
        complianceLevel: 1,
      },
      {
        id: "1.19.4",
        type: "release",
        url: "https://m/",
        time: "",
        releaseTime: "2023-03-01T00:00:00+00:00",
        sha1: "x",
        complianceLevel: 1,
      },
      {
        id: "23w14a",
        type: "snapshot",
        url: "https://m/",
        time: "",
        releaseTime: "2023-04-05T00:00:00+00:00",
        sha1: "x",
        complianceLevel: 1,
      },
    ] satisfies MinecraftVersionSummary[]);
  const target = input.resolvedTarget ?? fakeTarget;
  const fakePlan: InstallPlan = {
    targetId: target.id,
    directory: target.directory,
    target,
    actions: [],
    totalActions: 0,
    totalBytes: 0,
  };
  const fakeReport: InstallReport = {
    targetId: target.id,
    bytesDownloaded: 0,
    actionsCompleted: 0,
    actionsSkipped: 0,
    durationMs: 1,
  };
  const composition: LaunchComposition = input.composition ?? {
    targetId: target.id,
    directory: target.directory,
    javaPath: "/java",
    mainClass: target.minecraft.manifest.mainClass,
    jvmArgs: [],
    gameArgs: [],
    classpath: [],
    nativesDirectory: "/natives",
    auth: { mode: "offline", username: "Player" },
    workingDirectory: target.directory,
  };
  const launchExit: LaunchExit = input.launchExit ?? { code: 0, signal: null, aborted: false };
  const fakeRepairPlan: RepairPlan = {
    targetId: target.id,
    directory: target.directory,
    target,
    actions: [],
    totalActions: 0,
    totalBytes: 0,
  };
  const fakeRepairReport: RepairReport = {
    targetId: target.id,
    bytesDownloaded: 0,
    actionsCompleted: 0,
    durationMs: 1,
  };
  const verification: VerificationResult = input.verificationResult ?? {
    targetId: target.id,
    kind: "minecraft",
    isValid: true,
    issues: [],
    checkedFiles: 0,
    durationMs: 1,
  };
  const session: LaunchSession = {
    pid: 1234,
    exited: Promise.resolve(launchExit),
    abort() {},
  };
  const stubKit = {
    versions: {
      minecraft: {
        list: async () => minecraftVersions,
      },
      fabric: {
        list: async () => {
          const value = input.fabricLoaders ?? [];
          return typeof value === "function" ? value() : value;
        },
      },
      forge: {
        list: async () => {
          const value = input.forgeBuilds ?? [];
          return typeof value === "function" ? value() : value;
        },
      },
      runtime: {
        list: async () =>
          (input.runtimeList ?? []).map((r) => ({
            component: r.component,
            platformKey: "windows-x64",
            versionName: r.versionName,
            released: "2024-01-01",
            manifestUrl: "https://m/",
          })),
        resolve: async ({ component }: { readonly component?: string } = {}) => ({
          component: component ?? "java-runtime-gamma",
          platformKey: "windows-x64",
          versionName: "17.0.8",
          system: { os: "windows", arch: "x64", osVersion: "10.0" },
          manifestUrl: "https://m/",
          manifestSha1: "x",
        }),
      },
    },
    targets: {
      system: { os: "windows", arch: "x64", osVersion: "10.0" },
      resolve: async () => {
        if (input.resolveError !== undefined) throw input.resolveError;
        return target;
      },
      list: async () => input.listResult ?? [],
    },
    install: {
      plan: async () => {
        if (input.installError !== undefined) throw input.installError;
        return fakePlan;
      },
      run: async () => fakeReport,
      runtime: {
        plan: async () => {
          if (input.installError !== undefined) throw input.installError;
          return fakePlan;
        },
        run: async () => fakeReport,
        standalonePlan: async () => {
          if (input.installError !== undefined) throw input.installError;
          return fakePlan;
        },
      },
    },
    verify: {
      minecraft: { run: async () => verification },
      fabric: { run: async () => verification },
      forge: { run: async () => verification },
      runtime: { run: async () => verification },
    },
    repair: {
      minecraft: { plan: async () => fakeRepairPlan, run: async () => fakeRepairReport },
      fabric: { plan: async () => fakeRepairPlan, run: async () => fakeRepairReport },
      forge: { plan: async () => fakeRepairPlan, run: async () => fakeRepairReport },
      runtime: { plan: async () => fakeRepairPlan, run: async () => fakeRepairReport },
      all: async () => ({
        verifications: [verification],
        repairs: new Map(),
        bytesDownloaded: 0,
        durationMs: 1,
      }),
    },
    launch: {
      compose: async () => composition,
      run: () => session,
    },
  };
  return stubKit as unknown as MinecraftKit;
};
