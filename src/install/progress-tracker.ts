import type { ProgressEvent, ProgressListener } from "../types/events";
import { EventTypes } from "../types/events";
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
 * Two matched byte pairs, so a ratio is always self-consistent: `bytesDownloaded` / `totalBytes`
 * describe the current `stage`, `overallBytesDownloaded` / `overallTotalBytes` the whole run.
 * Never divide across the pairs.
 *
 * @example
 * ```ts
 * import type { ProgressSnapshot } from "@loontail/minecraft-kit";
 *
 * const render = (s: ProgressSnapshot) => {
 *   console.log(`${s.stage} ${s.bytesDownloaded}/${s.totalBytes} bytes (${s.stagePercent.toFixed(0)}%)`);
 *   console.log(`overall ${s.overallBytesDownloaded}/${s.overallTotalBytes} (${s.overallPercent.toFixed(0)}%)`);
 *   if (s.currentFile) console.log(`  ${s.currentFile}`);
 * };
 * ```
 */
export type ProgressSnapshot = {
  readonly stage: ProgressStage;
  readonly stagePercent: number;
  readonly overallPercent: number;
  /** Bytes downloaded so far in the current stage. Denominator is {@link totalBytes}. */
  readonly bytesDownloaded: number;
  /** Expected bytes of the current stage. */
  readonly totalBytes: number;
  /** Bytes downloaded so far across every stage. Denominator is {@link overallTotalBytes}. */
  readonly overallBytesDownloaded: number;
  /** Expected bytes of the whole run. */
  readonly overallTotalBytes: number;
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
  /**
   * Force-emit a final snapshot and stop the throttle timer. The snapshot's stage is `finalize`,
   * whose byte pair carries the bytes the run ACTUALLY moved — so a run that downloaded everything
   * ends at 100%, while one that failed or was cancelled ends where it stopped instead of claiming
   * the whole plan. `overallBytesDownloaded` / `overallTotalBytes` are left untouched, so
   * `overallPercent` stays the honest figure on every path.
   */
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

  const percentOf = (bytes: number, total: number): number => {
    if (total > 0) return clamp((bytes / total) * 100);
    // why: a run with nothing to download (an already-complete repair) has no denominator, so it
    // only reads as 100% once the run is over.
    return finished ? 100 : 0;
  };

  const snapshot = (): ProgressSnapshot => {
    const stageTotal = stageTotals[currentStage];
    const stageBytes = stageDone[currentStage] + stageInFlight[currentStage];
    const overallBytes = totalDone + totalInFlight;
    return {
      stage: currentStage,
      stagePercent: percentOf(stageBytes, stageTotal),
      overallPercent: percentOf(overallBytes, overallTotal),
      bytesDownloaded: stageBytes,
      totalBytes: stageTotal,
      overallBytesDownloaded: overallBytes,
      overallTotalBytes: overallTotal,
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

  /**
   * Give back the bytes of an attempt that is being abandoned. A retry re-streams the file from
   * byte 0 (no HTTP Range resumption) and `downloadFile` emits a fresh `download:started` per
   * attempt, so without this the abandoned attempt's bytes stay in `stageInFlight` forever and the
   * numerator overruns the denominator.
   */
  const reclaimInFlight = (target: string): void => {
    const entry = inFlightByTarget.get(target);
    if (!entry) return;
    stageInFlight[entry.stage] -= entry.bytes;
    totalInFlight -= entry.bytes;
    inFlightByTarget.delete(target);
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
        reclaimInFlight(event.file.target);
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
          reclaimInFlight(event.file.target);
          stageDone[entry.stage] += finalBytes;
          totalDone += finalBytes;
        } else {
          applyCompletionWhenStartWasMissed(event.file.target, event.bytes);
          setStageFromAspect(event.aspect);
        }
        schedulePush();
        return;
      }
      case EventTypes.DOWNLOAD_FAILED: {
        reclaimInFlight(event.file.target);
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
      // why: no DownloadCategory maps to FINALIZE, so its own total is structurally 0 and the stage
      // pair would report 0/0 — the bar snapping back to 0% on the very last event of the run.
      // FINALIZE stands for the run ending, so it carries the bytes the run ACTUALLY moved rather
      // than the plan total: finish() also runs on failure and on cancel, and reporting the plan
      // there turned a run that died at 4% with its temp file already unlinked into a final
      // "23.8 MB / 23.8 MB downloaded". On the success path the two are equal, so that path is
      // unchanged. Only FINALIZE's own counters are touched — overwriting every stage's `done`
      // with its total made the per-stage denominators sum to twice the run, which double-counts
      // for any consumer drawing a segmented bar, and it inflated overallPercent to 100% on a
      // run that failed.
      const moved = totalDone + totalInFlight;
      totalDone = moved;
      totalInFlight = 0;
      stageTotals[ProgressStages.FINALIZE] = moved;
      stageDone[ProgressStages.FINALIZE] = moved;
      stageInFlight[ProgressStages.FINALIZE] = 0;
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
