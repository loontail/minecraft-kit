import { targetPaths } from "../core/paths";
import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import type { HttpClient } from "../types/http";
import {
  DownloadCategories,
  type InstallAction,
  InstallActionKinds,
  type InstallPlan,
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
};

/**
 * Build a flat install plan for the given target.
 *
 * @internal
 */
export const planInstall = async (input: PlanInstallInput): Promise<InstallPlan> => {
  const { target } = input;
  const actions: InstallAction[] = [];

  // 1. Vanilla client jar.
  actions.push({
    kind: InstallActionKinds.DOWNLOAD_FILE,
    url: target.minecraft.manifest.downloads.client.url,
    target: targetPaths.versionJar(target.directory, target.minecraft.version),
    expectedSha1: target.minecraft.manifest.downloads.client.sha1,
    expectedSize: target.minecraft.manifest.downloads.client.size,
    category: DownloadCategories.CLIENT_JAR,
  });

  // 2. Vanilla version JSON (write).
  actions.push({
    kind: InstallActionKinds.WRITE_VERSION_JSON,
    path: targetPaths.versionJson(target.directory, target.minecraft.version),
    content: `${JSON.stringify(target.minecraft.manifest, null, 2)}\n`,
  });

  // 3. Vanilla libraries + native extractions.
  const vanillaLibraries = planLibraryDownloads({
    libraries: target.minecraft.manifest.libraries,
    directory: target.directory,
    system: target.runtime.system,
    versionId: target.minecraft.version,
    category: DownloadCategories.LIBRARY,
  });
  actions.push(...vanillaLibraries.downloads);
  actions.push(...vanillaLibraries.nativeExtractions);

  // 4. Asset index + objects.
  const assetPlan = await planAssetDownloads({
    directory: target.directory,
    assetIndex: target.minecraft.manifest.assetIndex,
    http: input.http,
    cache: input.cache,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  });
  actions.push(...assetPlan.actions);

  // 5. Logging config.
  if (target.minecraft.manifest.logging?.client) {
    const logging = target.minecraft.manifest.logging.client;
    actions.push({
      kind: InstallActionKinds.DOWNLOAD_FILE,
      url: logging.file.url,
      target: targetPaths.loggingConfig(target.directory, logging.file.id),
      expectedSha1: logging.file.sha1,
      expectedSize: logging.file.size,
      category: DownloadCategories.LOGGING_CONFIG,
    });
  }

  // 6. Runtime files.
  const runtimePlan = await planRuntimeDownloads({
    runtime: target.runtime,
    directory: target.directory,
    http: input.http,
    cache: input.cache,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  });
  actions.push(...runtimePlan.actions);

  // 7. Loader-specific extras.
  if (target.loader.type === Loaders.FABRIC) {
    const fabricPlan = planFabricInstall({
      loader: target.loader,
      minecraft: target.minecraft,
      directory: target.directory,
      system: target.runtime.system,
    });
    actions.push(fabricPlan.versionJson);
    actions.push(...fabricPlan.libraryDownloads);
  } else if (target.loader.type === Loaders.FORGE) {
    const forgePlan = await planForgeInstall({
      loader: target.loader,
      minecraft: target.minecraft,
      directory: target.directory,
      system: target.runtime.system,
      http: input.http,
      cache: input.cache,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
      ...(input.onEvent !== undefined ? { onEvent: input.onEvent } : {}),
    });
    actions.push(forgePlan.installerDownload);
    actions.push(...forgePlan.libraryDownloads);
    actions.push(forgePlan.versionJson);
    actions.push(...forgePlan.processorActions);
  }

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
  };
};
