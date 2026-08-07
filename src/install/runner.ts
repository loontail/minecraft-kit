import pLimit from "p-limit";
import { DOWNLOAD_CONCURRENCY } from "../constants/defaults";
import { checkpoint as runCheckpoint } from "../core/abort";
import { extractAllToDir } from "../core/archive";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { atomicWrite } from "../core/fs";
import {
  withOptionalHostAllowList,
  withOptionalOnEvent,
  withOptionalPauseController,
  withOptionalSignal,
} from "../core/optional";
import { targetPaths } from "../core/paths";
import type { PauseController } from "../core/pause-controller";
import { downloadFile } from "../http/download";
import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import { EventTypes } from "../types/events";
import type { HttpClient } from "../types/http";
import {
  type DownloadAction,
  DownloadCategories,
  type DownloadCategory,
  type ExtractNativeAction,
  type InstallAction,
  InstallActionKinds,
  type InstallPhase,
  InstallPhases,
  type InstallPlan,
  type InstallReport,
  type RunForgeProcessorAction,
  type WriteLoggingConfigAction,
  type WriteVersionJsonAction,
} from "../types/install";
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
  /**
   * Cooperative pause. Checked at every stage/group boundary and between download chunks — an
   * in-flight download pauses mid-stream without aborting.
   */
  readonly pauseController?: PauseController;
  /**
   * Restricts the run to the listed download categories. Native extraction is skipped unless
   * `LIBRARY` is included; Forge processors unless `FORGE_LIBRARY` is included; the runtime
   * stage unless `RUNTIME_FILE` is included. Version-JSON and logging-config writes always run
   * — they are cheap, idempotent, and are what makes a partial run still leave a coherent tree.
   */
  readonly actionCategories?: ReadonlySet<DownloadAction["category"]>;
  /** Host allow-list enforced on every download (including redirect targets). */
  readonly hostAllowList?: readonly string[];
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
  await runRuntimeStage(ctx, plannedActions);
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
        ...withOptionalSignal(input.signal),
        ...withOptionalPauseController(input.pauseController),
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

/**
 * Split the plan into the four buckets each stage consumes, honouring `actionCategories`.
 *
 * The filter is not download-only: a post-download step whose inputs were filtered out must
 * not run either. Native extraction derives from `LIBRARY` jars and Forge processors from the
 * `FORGE_LIBRARY` classpath, so each is gated on its source category. Writes are deliberately
 * unconditional — see {@link RunInstallInput.actionCategories}.
 */
const partitionActions = (input: RunInstallInput): PlannedActions => {
  const allowedCategories = input.actionCategories;
  const allows = (category: DownloadCategory): boolean =>
    allowedCategories === undefined || allowedCategories.has(category);
  const allDownloads = input.plan.actions.filter(isDownload);
  return {
    downloads:
      allowedCategories === undefined
        ? allDownloads
        : allDownloads.filter((a) => allowedCategories.has(a.category)),
    natives: allows(DownloadCategories.LIBRARY) ? input.plan.actions.filter(isNative) : [],
    writes: input.plan.actions.filter(isWrite),
    processors: allows(DownloadCategories.FORGE_LIBRARY)
      ? input.plan.actions.filter(isProcessor)
      : [],
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
  await runUngroupedDownloadsAsLibraries(ctx, downloads);
};

/**
 * Run downloads whose category isn't claimed by any {@link DOWNLOAD_GROUPS} entry.
 *
 * Acts as a safety net: a newly-added `DownloadCategory` lands here under the generic
 * libraries phase instead of silently skipping its progress reporting, until
 * `DOWNLOAD_GROUPS` is updated to claim it.
 */
const runUngroupedDownloadsAsLibraries = async (
  ctx: InstallRunnerContext,
  downloads: readonly DownloadAction[],
): Promise<void> => {
  const ungrouped = downloads.filter(
    (action) => !DOWNLOAD_GROUPS.some((g) => g.categories.includes(action.category)),
  );
  if (ungrouped.length === 0) return;
  await ctx.checkpoint();
  ctx.enterPhase(InstallPhases.DOWNLOADING_LIBRARIES);
  await runDownloadGroup(ctx, ungrouped);
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
          ...withOptionalHostAllowList(ctx.input.hostAllowList),
          ...withOptionalSignal(ctx.input.signal),
          ...withOptionalOnEvent(ctx.input.onEvent),
          ...withOptionalPauseController(ctx.input.pauseController),
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

/**
 * Materialize the runtime's directory/symlink entries — but only when the run actually touched
 * runtime files.
 *
 * The gate is "at least one `RUNTIME_FILE` download survived `partitionActions`", which folds
 * two requirements into one predicate: an `actionCategories` filter that excludes
 * `RUNTIME_FILE` skips the stage, and so does a plan with no runtime work at all (every repair
 * plan that isn't a runtime repair). Without it, an assets-only repair paid a runtime-manifest
 * fetch plus a full `materializeRuntimeExtras` pass — which on Windows without symlink
 * privilege is a real file copy per `link` entry — and failed offline *after* its downloads had
 * already landed on disk.
 */
const runRuntimeStage = async (
  ctx: InstallRunnerContext,
  plannedActions: PlannedActions,
): Promise<void> => {
  const runtime = ctx.input.plan.target.runtime;
  if (runtime === undefined) return;
  if (!plannedActions.downloads.some((a) => a.category === DownloadCategories.RUNTIME_FILE)) {
    return;
  }
  await ctx.checkpoint();
  ctx.enterPhase(InstallPhases.INSTALLING_RUNTIME);
  const manifest =
    ctx.input.plan.runtimeManifest ??
    (
      await planRuntimeDownloads({
        runtime,
        directory: ctx.input.plan.directory,
        http: ctx.input.http,
        cache: ctx.input.cache,
        ...withOptionalSignal(ctx.input.signal),
      })
    ).manifest;
  await materializeRuntimeExtras({
    runtime,
    directory: ctx.input.plan.directory,
    manifest,
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
      ...withOptionalOnEvent(ctx.input.onEvent),
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
