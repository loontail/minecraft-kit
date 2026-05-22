import pLimit from "p-limit";
import { DOWNLOAD_CONCURRENCY } from "../constants/defaults";
import { checkpoint as runCheckpoint } from "../core/abort";
import { extractAllToDir } from "../core/archive";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { atomicWrite } from "../core/fs";
import { targetPaths } from "../core/paths";
import type { PauseController } from "../core/pause-controller";
import { downloadFile } from "../http/download";
import type { MetadataCache } from "../types/cache";
import { EventTypes } from "../types/events";
import type { ProgressListener } from "../types/events";
import type { HttpClient } from "../types/http";
import {
  type DownloadAction,
  DownloadCategories,
  type DownloadCategory,
  type ExtractNativeAction,
  type InstallAction,
  InstallActionKinds,
  type InstallPlan,
  type InstallReport,
  type RunForgeProcessorAction,
  type WriteLoggingConfigAction,
  type WriteVersionJsonAction,
} from "../types/install";
import { type InstallPhase, InstallPhases } from "../types/install";
import { Loaders } from "../types/loader";
import type { Spawner } from "../types/spawner";
import type { OperatingSystem } from "../types/system";
import { runProcessor } from "./processor";
import { planRuntimeDownloads } from "./runtime";
import { materializeRuntimeExtras } from "./runtime-extras";

/**
 * Inputs to the install runner.
 *
 * @internal
 */
export type RunInstallInput = {
  readonly plan: InstallPlan;
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly spawner: Spawner;
  readonly signal?: AbortSignal;
  readonly onEvent?: ProgressListener;
  readonly concurrency?: number;
  /** Checkpoint between top-level actions and group transitions. Does not interrupt in-flight downloads. */
  readonly pauseController?: PauseController;
  /** When set, only download actions in this set run; post-download steps that depend on them are skipped too. */
  readonly actionCategories?: ReadonlySet<DownloadAction["category"]>;
};

/** Download category → install phase mapping that runs each category as its own phase. */
const DOWNLOAD_GROUPS: ReadonlyArray<{
  readonly categories: ReadonlyArray<DownloadCategory>;
  readonly phase: InstallPhase;
}> = [
  { categories: [DownloadCategories.RUNTIME_FILE], phase: InstallPhases.INSTALLING_RUNTIME },
  { categories: [DownloadCategories.CLIENT_JAR], phase: InstallPhases.DOWNLOADING_CLIENT_JAR },
  { categories: [DownloadCategories.LIBRARY], phase: InstallPhases.DOWNLOADING_LIBRARIES },
  { categories: [DownloadCategories.ASSET_INDEX], phase: InstallPhases.DOWNLOADING_ASSET_INDEX },
  { categories: [DownloadCategories.ASSET], phase: InstallPhases.DOWNLOADING_ASSETS },
  { categories: [DownloadCategories.LOGGING_CONFIG], phase: InstallPhases.WRITING_FILES },
  { categories: [DownloadCategories.FABRIC_LIBRARY], phase: InstallPhases.INSTALLING_FABRIC },
  {
    categories: [DownloadCategories.FORGE_INSTALLER, DownloadCategories.FORGE_LIBRARY],
    phase: InstallPhases.INSTALLING_FORGE,
  },
];

type InstallCounters = {
  bytesDownloaded: number;
  actionsCompleted: number;
  actionsSkipped: number;
};

type InstallRunnerContext = {
  readonly input: RunInstallInput;
  readonly counters: InstallCounters;
  readonly checkpoint: () => Promise<void>;
  readonly enterPhase: (phase: InstallPhase) => void;
  readonly limit: ReturnType<typeof pLimit>;
};

type PlannedActions = {
  readonly downloads: readonly DownloadAction[];
  readonly natives: readonly ExtractNativeAction[];
  readonly writes: ReadonlyArray<WriteVersionJsonAction | WriteLoggingConfigAction>;
  readonly processors: readonly RunForgeProcessorAction[];
};

/**
 * Execute an install plan.
 *
 * @internal
 */
export const runInstall = async (input: RunInstallInput): Promise<InstallReport> => {
  const startedAt = Date.now();
  const counters: InstallCounters = { bytesDownloaded: 0, actionsCompleted: 0, actionsSkipped: 0 };
  const ctx = createContext(input, counters);

  ctx.enterPhase(InstallPhases.PLANNING);

  const plannedActions = partitionActions(input);
  await runDownloadsStage(ctx, plannedActions.downloads);
  await runWritesStage(ctx, plannedActions.writes);
  await runNativesStage(ctx, plannedActions.natives);
  await runRuntimeStage(ctx);
  await runProcessorsStage(ctx, plannedActions.processors);

  ctx.enterPhase(InstallPhases.COMPLETED);

  return {
    targetId: input.plan.targetId,
    bytesDownloaded: counters.bytesDownloaded,
    actionsCompleted: counters.actionsCompleted,
    actionsSkipped: counters.actionsSkipped,
    durationMs: Date.now() - startedAt,
  };
};

const createContext = (input: RunInstallInput, counters: InstallCounters): InstallRunnerContext => {
  let currentPhase: InstallPhase | null = null;
  const enterPhase = (phase: InstallPhase): void => {
    if (phase === currentPhase) return;
    input.onEvent?.({ type: EventTypes.INSTALL_PHASE_CHANGED, phase, previous: currentPhase });
    currentPhase = phase;
  };
  const checkpoint = (): Promise<void> =>
    runCheckpoint(
      {
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
        ...(input.pauseController !== undefined ? { pauseController: input.pauseController } : {}),
      },
      "Install aborted by signal",
    );
  return {
    input,
    counters,
    checkpoint,
    enterPhase,
    limit: pLimit(input.concurrency ?? DOWNLOAD_CONCURRENCY),
  };
};

const partitionActions = (input: RunInstallInput): PlannedActions => {
  const filter = input.actionCategories;
  return {
    downloads: input.plan.actions
      .filter(isDownload)
      .filter((a) => (filter ? filter.has(a.category) : true)),
    natives: input.plan.actions.filter(isNative),
    writes: input.plan.actions.filter(isWrite),
    processors: input.plan.actions.filter(isProcessor),
  };
};

const runDownloadsStage = async (
  ctx: InstallRunnerContext,
  downloads: readonly DownloadAction[],
): Promise<void> => {
  if (downloads.length === 0) return;
  for (const group of DOWNLOAD_GROUPS) {
    const groupActions = downloads.filter((action) => group.categories.includes(action.category));
    if (groupActions.length === 0) continue;
    await ctx.checkpoint();
    ctx.enterPhase(group.phase);
    await runDownloadGroup(ctx, groupActions);
  }
  // Categories not declared in DOWNLOAD_GROUPS fall back to the generic libraries phase, so a
  // newly-added download category does not silently skip its progress reporting.
  const ungrouped = downloads.filter(
    (action) => !DOWNLOAD_GROUPS.some((g) => g.categories.includes(action.category)),
  );
  if (ungrouped.length > 0) {
    await ctx.checkpoint();
    ctx.enterPhase(InstallPhases.DOWNLOADING_LIBRARIES);
    await runDownloadGroup(ctx, ungrouped);
  }
};

const runDownloadGroup = async (
  ctx: InstallRunnerContext,
  groupActions: readonly DownloadAction[],
): Promise<void> => {
  await Promise.all(
    groupActions.map((action) =>
      ctx.limit(async () => {
        await ctx.checkpoint();
        const result = await downloadFile(ctx.input.http, {
          url: action.url,
          target: action.target,
          ...(action.expectedSha1 !== undefined ? { expectedSha1: action.expectedSha1 } : {}),
          ...(action.expectedSize !== undefined ? { expectedSize: action.expectedSize } : {}),
          ...(action.category !== undefined ? { category: action.category } : {}),
          ...(ctx.input.signal !== undefined ? { signal: ctx.input.signal } : {}),
          ...(ctx.input.onEvent !== undefined ? { onEvent: ctx.input.onEvent } : {}),
          ...(ctx.input.pauseController !== undefined
            ? { pauseController: ctx.input.pauseController }
            : {}),
        });
        ctx.counters.bytesDownloaded += result.bytesDownloaded;
        if (result.skipped) ctx.counters.actionsSkipped++;
        ctx.counters.actionsCompleted++;
      }),
    ),
  );
};

const runWritesStage = async (
  ctx: InstallRunnerContext,
  writes: ReadonlyArray<WriteVersionJsonAction | WriteLoggingConfigAction>,
): Promise<void> => {
  if (writes.length === 0) return;
  await ctx.checkpoint();
  ctx.enterPhase(InstallPhases.WRITING_FILES);
  for (const action of writes) {
    await ctx.checkpoint();
    await atomicWrite(action.path, action.content);
    ctx.counters.actionsCompleted++;
  }
};

const runNativesStage = async (
  ctx: InstallRunnerContext,
  natives: readonly ExtractNativeAction[],
): Promise<void> => {
  if (natives.length === 0) return;
  await ctx.checkpoint();
  ctx.enterPhase(InstallPhases.EXTRACTING_NATIVES);
  for (const action of natives) {
    await ctx.checkpoint();
    const { fileCount } = await extractAllToDir(action.source, action.destination, {
      excludePrefixes: action.exclude as readonly string[],
    });
    ctx.input.onEvent?.({
      type: EventTypes.ARCHIVE_EXTRACTED,
      archive: action.source,
      target: action.destination,
      fileCount,
    });
    ctx.counters.actionsCompleted++;
  }
};

const runRuntimeStage = async (ctx: InstallRunnerContext): Promise<void> => {
  const runtime = ctx.input.plan.target.runtime;
  if (runtime === undefined) return;
  await ctx.checkpoint();
  ctx.enterPhase(InstallPhases.INSTALLING_RUNTIME);
  const runtimePlan = await planRuntimeDownloads({
    runtime,
    directory: ctx.input.plan.directory,
    http: ctx.input.http,
    cache: ctx.input.cache,
    ...(ctx.input.signal !== undefined ? { signal: ctx.input.signal } : {}),
  });
  await materializeRuntimeExtras({
    runtime,
    directory: ctx.input.plan.directory,
    manifest: runtimePlan.manifest,
  });
};

const runProcessorsStage = async (
  ctx: InstallRunnerContext,
  processors: readonly RunForgeProcessorAction[],
): Promise<void> => {
  if (processors.length === 0) return;
  await ctx.checkpoint();
  ctx.enterPhase(InstallPhases.RUNNING_FORGE_PROCESSORS);
  const target = ctx.input.plan.target;
  if (target.loader?.type !== Loaders.FORGE) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.FORGE_PROCESSOR_FAILED,
      "Forge processors planned for a non-Forge target",
    );
  }
  const javaPath = targetPaths.runtimeJavaExecutable(
    ctx.input.plan.directory,
    target.runtime.component,
    target.runtime.system.os as OperatingSystem,
    target.runtime.installRoot,
  );
  for (const action of processors) {
    await ctx.checkpoint();
    await runProcessor({
      action,
      javaPath,
      spawner: ctx.input.spawner,
      ...(ctx.input.onEvent !== undefined ? { onEvent: ctx.input.onEvent } : {}),
      total: processors.length,
    });
    ctx.counters.actionsCompleted++;
  }
};

const isDownload = (action: InstallAction): action is DownloadAction => {
  return action.kind === InstallActionKinds.DOWNLOAD_FILE;
};

const isNative = (action: InstallAction): action is ExtractNativeAction => {
  return action.kind === InstallActionKinds.EXTRACT_NATIVE;
};

const isProcessor = (action: InstallAction): action is RunForgeProcessorAction => {
  return action.kind === InstallActionKinds.RUN_FORGE_PROCESSOR;
};

const isWrite = (
  action: InstallAction,
): action is WriteVersionJsonAction | WriteLoggingConfigAction => {
  return (
    action.kind === InstallActionKinds.WRITE_VERSION_JSON ||
    action.kind === InstallActionKinds.WRITE_LOGGING_CONFIG
  );
};
