import {
  withOptionalHostAllowList,
  withOptionalOnEvent,
  withOptionalSignal,
} from "../core/optional";
import { targetPaths } from "../core/paths";
import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import type { HttpClient } from "../types/http";
import {
  type DownloadAction,
  DownloadCategories,
  type InstallAction,
  InstallActionKinds,
  type InstallPlan,
  type WriteVersionJsonAction,
} from "../types/install";
import { Loaders } from "../types/loader";
import type { Target } from "../types/target";
import { planAssetDownloads } from "./assets";
import { planFabricInstall } from "./fabric-install";
import { planForgeInstall } from "./forge-install";
import { planLibraryDownloads } from "./libraries";
import { planRuntimeDownloads } from "./runtime";

/**
 * Inputs to the install planner.
 *
 * @internal
 */
export type PlanInstallInput = {
  readonly target: Target;
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly signal?: AbortSignal;
  readonly onEvent?: ProgressListener;
  /**
   * Host allow-list for the downloads planning itself performs. Only the Forge path
   * downloads during planning (the installer JAR); every other download happens in the
   * install runner, which takes its own allow-list.
   */
  readonly hostAllowList?: readonly string[];
};

/**
 * Build a flat install plan for the given target.
 *
 * @internal
 */
export const planInstall = async (input: PlanInstallInput): Promise<InstallPlan> => {
  const { target } = input;
  const runtime = await planRuntimeFiles(input);
  const actions: InstallAction[] = [
    planClientJarAction(target),
    planVersionJsonWriteAction(target),
    ...planVanillaLibraries(target),
    ...(await planAssetIndexAndObjects(input)),
    ...planLoggingConfigAction(target),
    ...runtime.actions,
    ...(await planLoaderExtras(input)),
  ];

  const totalBytes = actions.reduce((sum, action) => {
    if (action.kind === InstallActionKinds.DOWNLOAD_FILE) {
      return sum + (action.expectedSize ?? 0);
    }
    return sum;
  }, 0);

  return {
    targetId: target.id,
    directory: target.directory,
    target,
    actions,
    totalActions: actions.length,
    totalBytes,
    runtimeManifest: runtime.manifest,
  };
};

const planClientJarAction = (target: Target): DownloadAction => ({
  kind: InstallActionKinds.DOWNLOAD_FILE,
  url: target.minecraft.manifest.downloads.client.url,
  target: targetPaths.versionJar(target.directory, target.minecraft.version),
  expectedSha1: target.minecraft.manifest.downloads.client.sha1,
  expectedSize: target.minecraft.manifest.downloads.client.size,
  category: DownloadCategories.CLIENT_JAR,
});

const planVersionJsonWriteAction = (target: Target): WriteVersionJsonAction => ({
  kind: InstallActionKinds.WRITE_VERSION_JSON,
  path: targetPaths.versionJson(target.directory, target.minecraft.version),
  content: `${JSON.stringify(target.minecraft.manifest, null, 2)}\n`,
});

const planVanillaLibraries = (target: Target): readonly InstallAction[] => {
  const plan = planLibraryDownloads({
    libraries: target.minecraft.manifest.libraries,
    directory: target.directory,
    system: target.runtime.system,
    versionId: target.minecraft.version,
    category: DownloadCategories.LIBRARY,
  });
  return [...plan.downloads, ...plan.nativeExtractions];
};

const planAssetIndexAndObjects = async (
  input: PlanInstallInput,
): Promise<readonly InstallAction[]> => {
  const plan = await planAssetDownloads({
    directory: input.target.directory,
    assetIndex: input.target.minecraft.manifest.assetIndex,
    http: input.http,
    cache: input.cache,
    ...withOptionalSignal(input.signal),
  });
  return plan.actions;
};

const planLoggingConfigAction = (target: Target): readonly InstallAction[] => {
  const logging = target.minecraft.manifest.logging?.client;
  if (!logging) return [];
  return [
    {
      kind: InstallActionKinds.DOWNLOAD_FILE,
      url: logging.file.url,
      target: targetPaths.loggingConfig(target.directory, logging.file.id),
      expectedSha1: logging.file.sha1,
      expectedSize: logging.file.size,
      category: DownloadCategories.LOGGING_CONFIG,
    },
  ];
};

const planRuntimeFiles = async (
  input: PlanInstallInput,
): Promise<Awaited<ReturnType<typeof planRuntimeDownloads>>> => {
  return planRuntimeDownloads({
    runtime: input.target.runtime,
    directory: input.target.directory,
    http: input.http,
    cache: input.cache,
    ...withOptionalSignal(input.signal),
  });
};

const planLoaderExtras = async (input: PlanInstallInput): Promise<readonly InstallAction[]> => {
  const { target } = input;
  if (target.loader.type === Loaders.FABRIC) {
    const plan = planFabricInstall({
      loader: target.loader,
      minecraft: target.minecraft,
      directory: target.directory,
      system: target.runtime.system,
    });
    return [plan.versionJson, ...plan.libraryDownloads];
  }
  if (target.loader.type === Loaders.FORGE) {
    const plan = await planForgeInstall({
      loader: target.loader,
      minecraft: target.minecraft,
      directory: target.directory,
      system: target.runtime.system,
      http: input.http,
      cache: input.cache,
      ...withOptionalSignal(input.signal),
      ...withOptionalOnEvent(input.onEvent),
      ...withOptionalHostAllowList(input.hostAllowList),
    });
    // why: the installer JAR is a planning *input*, not a launch artifact, so it is deliberately
    // not a plan action — re-emitting it would have `install.run` re-download bytes planning
    // already fetched, and Forge publishes no hash, so skip-on-correct could never suppress it.
    // The invariant that buys, and its limit: a Forge plan is only replayable while the installer
    // planning materialised is still on disk. `{INSTALLER}` is substituted into processor args
    // (see `forge-processor-plan`), and no action in the plan puts the JAR back. Re-plan after the
    // installer has been swept; do not re-run a stale plan.
    return [...plan.libraryDownloads, plan.versionJson, ...plan.processorActions];
  }
  return [];
};
