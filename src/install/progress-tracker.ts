import { EventTypes } from "../types/events";
import type { ProgressEvent, ProgressListener } from "../types/events";
import {
  DownloadCategories,
  type DownloadCategory,
  type InstallPhase,
  InstallPhases,
  type InstallPlan,
} from "../types/install";

/**
 * UI-oriented coarse progress stages, identical across install and repair flows.
 *
 * @example
 * ```ts
 * import { InstallStages, type InstallStage } from "@loontail/minecraft-kit";
 *
 * const labels: Record<InstallStage, string> = {
 *   [InstallStages.PREPARE]: "Preparing…",
 *   [InstallStages.RUNTIME]: "Installing Java",
 *   [InstallStages.MINECRAFT]: "Downloading game",
 *   [InstallStages.LOADER]: "Installing mod loader",
 *   [InstallStages.FINALIZE]: "Done",
 * };
 * ```
 */
export const InstallStages = {
  PREPARE: "prepare",
  RUNTIME: "runtime",
  MINECRAFT: "minecraft",
  LOADER: "loader",
  FINALIZE: "finalize",
} as const;

/**
 * Literal type of {@link InstallStages}. Use for exhaustive switches in UI code.
 *
 * @example
 * ```ts
 * import { InstallStages, type InstallStage } from "@loontail/minecraft-kit";
 *
 * function color(stage: InstallStage): string {
 *   return stage === InstallStages.FINALIZE ? "green" : "blue";
 * }
 * ```
 */
export type InstallStage = (typeof InstallStages)[keyof typeof InstallStages];

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
  readonly stage: InstallStage;
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

const STAGE_FOR_CATEGORY: Record<DownloadCategory, InstallStage> = {
  [DownloadCategories.RUNTIME_FILE]: InstallStages.RUNTIME,
  [DownloadCategories.CLIENT_JAR]: InstallStages.MINECRAFT,
  [DownloadCategories.LIBRARY]: InstallStages.MINECRAFT,
  [DownloadCategories.ASSET_INDEX]: InstallStages.MINECRAFT,
  [DownloadCategories.ASSET]: InstallStages.MINECRAFT,
  [DownloadCategories.LOGGING_CONFIG]: InstallStages.MINECRAFT,
  [DownloadCategories.FABRIC_LIBRARY]: InstallStages.LOADER,
  [DownloadCategories.FORGE_LIBRARY]: InstallStages.LOADER,
  [DownloadCategories.FORGE_INSTALLER]: InstallStages.LOADER,
};

const STAGE_FOR_PHASE: Partial<Record<InstallPhase, InstallStage>> = {
  [InstallPhases.PLANNING]: InstallStages.PREPARE,
  [InstallPhases.DOWNLOADING_VERSION_MANIFEST]: InstallStages.PREPARE,
  [InstallPhases.INSTALLING_RUNTIME]: InstallStages.RUNTIME,
  [InstallPhases.DOWNLOADING_CLIENT_JAR]: InstallStages.MINECRAFT,
  [InstallPhases.DOWNLOADING_LIBRARIES]: InstallStages.MINECRAFT,
  [InstallPhases.DOWNLOADING_ASSET_INDEX]: InstallStages.MINECRAFT,
  [InstallPhases.DOWNLOADING_ASSETS]: InstallStages.MINECRAFT,
  [InstallPhases.EXTRACTING_NATIVES]: InstallStages.MINECRAFT,
  [InstallPhases.WRITING_FILES]: InstallStages.MINECRAFT,
  [InstallPhases.INSTALLING_FABRIC]: InstallStages.LOADER,
  [InstallPhases.INSTALLING_FORGE]: InstallStages.LOADER,
  [InstallPhases.RUNNING_FORGE_PROCESSORS]: InstallStages.LOADER,
  [InstallPhases.COMPLETED]: InstallStages.FINALIZE,
};

const ALL_STAGES: readonly InstallStage[] = [
  InstallStages.PREPARE,
  InstallStages.RUNTIME,
  InstallStages.MINECRAFT,
  InstallStages.LOADER,
  InstallStages.FINALIZE,
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

  const stageOfTarget = new Map<string, InstallStage>();
  const expectedSizeOf = new Map<string, number>();
  const stageTotals: Record<InstallStage, number> = {
    prepare: 0,
    runtime: 0,
    minecraft: 0,
    loader: 0,
    finalize: 0,
  };
  let overallTotal = 0;
  for (const action of plan.actions) {
    if (action.kind !== "download-file") continue;
    const stage = STAGE_FOR_CATEGORY[action.category] ?? InstallStages.MINECRAFT;
    stageOfTarget.set(action.target, stage);
    const size = action.expectedSize ?? 0;
    expectedSizeOf.set(action.target, size);
    stageTotals[stage] += size;
    overallTotal += size;
  }

  const stageDone: Record<InstallStage, number> = {
    prepare: 0,
    runtime: 0,
    minecraft: 0,
    loader: 0,
    finalize: 0,
  };
  const stageInFlight: Record<InstallStage, number> = {
    prepare: 0,
    runtime: 0,
    minecraft: 0,
    loader: 0,
    finalize: 0,
  };
  let totalDone = 0;
  let totalInFlight = 0;
  const inFlightByTarget = new Map<string, { stage: InstallStage; bytes: number }>();
  let currentStage: InstallStage = InstallStages.PREPARE;
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

  const onEvent: ProgressListener = (event: ProgressEvent) => {
    switch (event.type) {
      case EventTypes.INSTALL_PHASE_CHANGED: {
        const next = STAGE_FOR_PHASE[event.phase];
        if (next && next !== currentStage) {
          currentStage = next;
          currentFile = undefined;
          push();
        }
        return;
      }
      case EventTypes.DOWNLOAD_STARTED: {
        const stage = stageOfTarget.get(event.file.target) ?? currentStage;
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
        }
        currentFile = event.file.target;
        schedulePush();
        return;
      }
      case EventTypes.DOWNLOAD_SKIPPED: {
        const stage = stageOfTarget.get(event.file.target);
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
          // No `download:started` observed (subscriber attached mid-flight, or tests).
          const stage = stageOfTarget.get(event.file.target);
          if (stage) {
            const bytes = event.bytes ?? expectedSizeOf.get(event.file.target) ?? 0;
            stageDone[stage] += bytes;
            totalDone += bytes;
          }
        }
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
      currentStage = InstallStages.FINALIZE;
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
