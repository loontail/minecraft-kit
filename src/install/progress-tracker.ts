import { EventTypes } from "../types/events";
import type { ProgressEvent, ProgressListener } from "../types/events";
import {
  DownloadCategories,
  type DownloadCategory,
  InstallActionKinds,
  type InstallPhase,
  InstallPhases,
  type InstallPlan,
} from "../types/install";
import { type VerificationKind, VerificationKinds } from "../types/verify";

/**
 * UI-oriented coarse progress stages, identical across install and repair flows.
 *
 * @example
 * ```ts
 * import { ProgressStages, type ProgressStage } from "@loontail/minecraft-kit";
 *
 * const labels: Record<ProgressStage, string> = {
 *   [ProgressStages.PREPARE]: "Preparing…",
 *   [ProgressStages.RUNTIME]: "Installing Java",
 *   [ProgressStages.MINECRAFT]: "Downloading game",
 *   [ProgressStages.LOADER]: "Installing mod loader",
 *   [ProgressStages.FINALIZE]: "Done",
 * };
 * ```
 */
export const ProgressStages = {
  PREPARE: "prepare",
  RUNTIME: "runtime",
  MINECRAFT: "minecraft",
  LOADER: "loader",
  FINALIZE: "finalize",
} as const;

/**
 * Literal type of {@link ProgressStages}. Use for exhaustive switches in UI code.
 *
 * @example
 * ```ts
 * import { ProgressStages, type ProgressStage } from "@loontail/minecraft-kit";
 *
 * function color(stage: ProgressStage): string {
 *   return stage === ProgressStages.FINALIZE ? "green" : "blue";
 * }
 * ```
 */
export type ProgressStage = (typeof ProgressStages)[keyof typeof ProgressStages];

/**
 * Snapshot pushed to {@link InstallProgressTracker} subscribers.
 *
 * @example
 * ```ts
 * import type { ProgressSnapshot } from "@loontail/minecraft-kit";
 *
 * const render = (s: ProgressSnapshot) => {
 *   console.log(`${s.stage} ${s.stagePercent.toFixed(0)}% (overall ${s.overallPercent.toFixed(0)}%)`);
 *   if (s.currentFile) console.log(`  ${s.currentFile}`);
 * };
 * ```
 */
export type ProgressSnapshot = {
  readonly stage: ProgressStage;
  readonly stagePercent: number;
  readonly overallPercent: number;
  readonly bytesDownloaded: number;
  readonly totalBytes: number;
  readonly currentFile?: string;
};

/**
 * Options for {@link createInstallProgressTracker}.
 *
 * @example
 * ```ts
 * import { createInstallProgressTracker, type ProgressTrackerOptions } from "@loontail/minecraft-kit";
 *
 * const options: ProgressTrackerOptions = { throttleMs: 250 };
 * const tracker = createInstallProgressTracker(plan, options);
 * ```
 */
export type ProgressTrackerOptions = {
  /** Milliseconds between snapshot pushes. Defaults to 100ms. */
  readonly throttleMs?: number;
};

/**
 * Aggregator returned by {@link createInstallProgressTracker}. Wire `onEvent` into
 * `install.run` / `repair.run`, and `subscribe` into your UI layer.
 *
 * @example
 * ```ts
 * import { createInstallProgressTracker, type InstallProgressTracker } from "@loontail/minecraft-kit";
 *
 * const tracker: InstallProgressTracker = createInstallProgressTracker(plan);
 * const unsubscribe = tracker.subscribe((s) => renderBar(s));
 * await kit.install.run(plan, { onEvent: tracker.onEvent });
 * tracker.finish();
 * unsubscribe();
 * ```
 */
export type InstallProgressTracker = {
  /** Pass directly as the `onEvent` callback to `install.run` / `repair.run`. */
  readonly onEvent: ProgressListener;
  snapshot(): ProgressSnapshot;
  /** First push fires immediately with the initial snapshot. */
  subscribe(listener: (snapshot: ProgressSnapshot) => void): () => void;
  /** Force-emit a final 100% snapshot and stop the throttle timer. */
  finish(): void;
};

const PROGRESS_STAGE_FOR_CATEGORY: Record<DownloadCategory, ProgressStage> = {
  [DownloadCategories.RUNTIME_FILE]: ProgressStages.RUNTIME,
  [DownloadCategories.CLIENT_JAR]: ProgressStages.MINECRAFT,
  [DownloadCategories.LIBRARY]: ProgressStages.MINECRAFT,
  [DownloadCategories.ASSET_INDEX]: ProgressStages.MINECRAFT,
  [DownloadCategories.ASSET]: ProgressStages.MINECRAFT,
  [DownloadCategories.LOGGING_CONFIG]: ProgressStages.MINECRAFT,
  [DownloadCategories.FABRIC_LIBRARY]: ProgressStages.LOADER,
  [DownloadCategories.FORGE_LIBRARY]: ProgressStages.LOADER,
  [DownloadCategories.FORGE_INSTALLER]: ProgressStages.LOADER,
};

const PROGRESS_STAGE_FOR_PHASE: Partial<Record<InstallPhase, ProgressStage>> = {
  [InstallPhases.PLANNING]: ProgressStages.PREPARE,
  [InstallPhases.DOWNLOADING_VERSION_MANIFEST]: ProgressStages.PREPARE,
  [InstallPhases.INSTALLING_RUNTIME]: ProgressStages.RUNTIME,
  [InstallPhases.DOWNLOADING_CLIENT_JAR]: ProgressStages.MINECRAFT,
  [InstallPhases.DOWNLOADING_LIBRARIES]: ProgressStages.MINECRAFT,
  [InstallPhases.DOWNLOADING_ASSET_INDEX]: ProgressStages.MINECRAFT,
  [InstallPhases.DOWNLOADING_ASSETS]: ProgressStages.MINECRAFT,
  [InstallPhases.EXTRACTING_NATIVES]: ProgressStages.MINECRAFT,
  [InstallPhases.WRITING_FILES]: ProgressStages.MINECRAFT,
  [InstallPhases.INSTALLING_FABRIC]: ProgressStages.LOADER,
  [InstallPhases.INSTALLING_FORGE]: ProgressStages.LOADER,
  [InstallPhases.RUNNING_FORGE_PROCESSORS]: ProgressStages.LOADER,
  [InstallPhases.COMPLETED]: ProgressStages.FINALIZE,
};

const PROGRESS_STAGE_FOR_ASPECT: Record<VerificationKind, ProgressStage> = {
  [VerificationKinds.MINECRAFT]: ProgressStages.MINECRAFT,
  [VerificationKinds.RUNTIME]: ProgressStages.RUNTIME,
  [VerificationKinds.FABRIC]: ProgressStages.LOADER,
  [VerificationKinds.FORGE]: ProgressStages.LOADER,
};

const ALL_STAGES: readonly ProgressStage[] = [
  ProgressStages.PREPARE,
  ProgressStages.RUNTIME,
  ProgressStages.MINECRAFT,
  ProgressStages.LOADER,
  ProgressStages.FINALIZE,
];

/**
 * Aggregate `ProgressEvent`s from one install/repair run into throttled UI snapshots.
 *
 * @example
 * ```ts
 * import { createInstallProgressTracker, MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const tracker = createInstallProgressTracker(plan, { throttleMs: 100 });
 * tracker.subscribe(({ stage, stagePercent }) => console.log(stage, stagePercent));
 * await kit.install.run(plan, { onEvent: tracker.onEvent });
 * tracker.finish();
 * ```
 */
export const createInstallProgressTracker = (
  plan: Pick<InstallPlan, "actions">,
  options: ProgressTrackerOptions = {},
): InstallProgressTracker => {
  const throttleMs = options.throttleMs ?? 100;

  const stageOfTarget = new Map<string, ProgressStage>();
  const expectedSizeOf = new Map<string, number>();
  const stageTotals: Record<ProgressStage, number> = {
    prepare: 0,
    runtime: 0,
    minecraft: 0,
    loader: 0,
    finalize: 0,
  };
  let overallTotal = 0;
  for (const action of plan.actions) {
    if (action.kind !== InstallActionKinds.DOWNLOAD_FILE) continue;
    const stage = PROGRESS_STAGE_FOR_CATEGORY[action.category] ?? ProgressStages.MINECRAFT;
    stageOfTarget.set(action.target, stage);
    const size = action.expectedSize ?? 0;
    expectedSizeOf.set(action.target, size);
    stageTotals[stage] += size;
    overallTotal += size;
  }

  const stageDone: Record<ProgressStage, number> = {
    prepare: 0,
    runtime: 0,
    minecraft: 0,
    loader: 0,
    finalize: 0,
  };
  const stageInFlight: Record<ProgressStage, number> = {
    prepare: 0,
    runtime: 0,
    minecraft: 0,
    loader: 0,
    finalize: 0,
  };
  let totalDone = 0;
  let totalInFlight = 0;
  const inFlightByTarget = new Map<string, { stage: ProgressStage; bytes: number }>();
  let currentStage: ProgressStage = ProgressStages.PREPARE;
  let currentFile: string | undefined;

  const listeners = new Set<(snapshot: ProgressSnapshot) => void>();
  let lastPushAt = 0;
  let pending = false;
  let pendingTimer: NodeJS.Timeout | null = null;
  let finished = false;

  const snapshot = (): ProgressSnapshot => {
    const stageTotal = stageTotals[currentStage];
    const stageBytes = stageDone[currentStage] + stageInFlight[currentStage];
    const overallBytes = totalDone + totalInFlight;
    return {
      stage: currentStage,
      stagePercent: stageTotal > 0 ? clamp((stageBytes / stageTotal) * 100) : 0,
      overallPercent: overallTotal > 0 ? clamp((overallBytes / overallTotal) * 100) : 0,
      bytesDownloaded: overallBytes,
      totalBytes: stageTotal,
      ...(currentFile !== undefined ? { currentFile } : {}),
    };
  };

  const clearTimer = (): void => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const push = (): void => {
    pending = false;
    clearTimer();
    lastPushAt = Date.now();
    const snap = snapshot();
    for (const listener of listeners) listener(snap);
  };

  const schedulePush = (): void => {
    if (finished) return;
    const elapsed = Date.now() - lastPushAt;
    if (elapsed >= throttleMs) {
      push();
      return;
    }
    if (pending) return;
    pending = true;
    pendingTimer = setTimeout(push, throttleMs - elapsed);
  };

  const applyCompletionWhenStartWasMissed = (
    target: string,
    eventBytes: number | undefined,
  ): void => {
    const stage = stageOfTarget.get(target);
    if (!stage) return;
    const bytes = eventBytes ?? expectedSizeOf.get(target) ?? 0;
    stageDone[stage] += bytes;
    totalDone += bytes;
  };

  const setStageFromAspect = (aspect: VerificationKind | undefined): ProgressStage | undefined => {
    if (aspect === undefined) return undefined;
    const stage = PROGRESS_STAGE_FOR_ASPECT[aspect];
    if (stage !== currentStage) currentStage = stage;
    return stage;
  };

  const onEvent: ProgressListener = (event: ProgressEvent) => {
    switch (event.type) {
      case EventTypes.INSTALL_PHASE_CHANGED: {
        const next = PROGRESS_STAGE_FOR_PHASE[event.phase];
        if (next && next !== currentStage) {
          currentStage = next;
          currentFile = undefined;
          push();
        }
        return;
      }
      case EventTypes.DOWNLOAD_STARTED: {
        const stage =
          stageOfTarget.get(event.file.target) ?? setStageFromAspect(event.aspect) ?? currentStage;
        inFlightByTarget.set(event.file.target, { stage, bytes: 0 });
        currentFile = event.file.target;
        schedulePush();
        return;
      }
      case EventTypes.DOWNLOAD_PROGRESS: {
        const entry = inFlightByTarget.get(event.file.target);
        if (entry) {
          const delta = event.bytesDownloaded - entry.bytes;
          if (delta !== 0) {
            entry.bytes = event.bytesDownloaded;
            stageInFlight[entry.stage] += delta;
            totalInFlight += delta;
          }
        } else {
          setStageFromAspect(event.aspect);
        }
        currentFile = event.file.target;
        schedulePush();
        return;
      }
      case EventTypes.DOWNLOAD_SKIPPED: {
        const stage = stageOfTarget.get(event.file.target) ?? setStageFromAspect(event.aspect);
        if (stage) {
          const size = expectedSizeOf.get(event.file.target) ?? 0;
          stageDone[stage] += size;
          totalDone += size;
          schedulePush();
        }
        return;
      }
      case EventTypes.DOWNLOAD_COMPLETED: {
        const entry = inFlightByTarget.get(event.file.target);
        if (entry) {
          const finalBytes = event.bytes ?? entry.bytes;
          stageInFlight[entry.stage] -= entry.bytes;
          totalInFlight -= entry.bytes;
          stageDone[entry.stage] += finalBytes;
          totalDone += finalBytes;
          inFlightByTarget.delete(event.file.target);
        } else {
          applyCompletionWhenStartWasMissed(event.file.target, event.bytes);
          setStageFromAspect(event.aspect);
        }
        schedulePush();
        return;
      }
      case EventTypes.VERIFY_FILE_CHECKED: {
        setStageFromAspect(event.aspect);
        currentFile = event.file.path;
        schedulePush();
        return;
      }
      default:
        return;
    }
  };

  return {
    onEvent,
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    finish() {
      finished = true;
      clearTimer();
      currentStage = ProgressStages.FINALIZE;
      currentFile = undefined;
      totalDone = overallTotal;
      totalInFlight = 0;
      for (const stage of ALL_STAGES) {
        stageDone[stage] = stageTotals[stage];
        stageInFlight[stage] = 0;
      }
      const snap = snapshot();
      for (const listener of listeners) listener(snap);
    },
  };
};

const clamp = (value: number): number => {
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return value;
};
