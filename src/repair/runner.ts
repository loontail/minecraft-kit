import {
  withOptionalHostAllowList,
  withOptionalOnEvent,
  withOptionalPauseController,
  withOptionalSignal,
} from "../core/optional";
import type { PauseController } from "../core/pause-controller";
import { runInstall } from "../install/runner";
import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import type { HttpClient } from "../types/http";
import type { DownloadAction } from "../types/install";
import type { RepairPlan, RepairReport } from "../types/repair";
import type { Spawner } from "../types/spawner";

/**
 * Inputs to {@link runRepair}. Shared across all aspect-specific repair flows.
 *
 * @internal
 */
export type RunRepairInput = {
  readonly plan: RepairPlan;
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly spawner: Spawner;
  readonly signal?: AbortSignal;
  readonly onEvent?: ProgressListener;
  /** Host allow-list forwarded to the install runner's downloads. */
  readonly hostAllowList?: readonly string[];
  /** Cooperative pause, forwarded to the install runner. */
  readonly pauseController?: PauseController;
  /** Category filter, forwarded to the install runner. */
  readonly actionCategories?: ReadonlySet<DownloadAction["category"]>;
};

/**
 * Execute any repair plan. Reuses the install runner.
 *
 * Prefer `kit.repair.<aspect>.run(plan)` over importing this directly.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const verification = await kit.verify.minecraft.run(target);
 * const plan = await kit.repair.minecraft.plan(target, { from: verification });
 * const report = await kit.repair.minecraft.run(plan);
 * console.log(
 *   `checked ${report.actionsCompleted} files, ${report.actionsSkipped} were already correct`,
 * );
 * ```
 */
export const runRepair = async (input: RunRepairInput): Promise<RepairReport> => {
  const report = await runInstall({
    plan: input.plan,
    http: input.http,
    cache: input.cache,
    spawner: input.spawner,
    ...withOptionalHostAllowList(input.hostAllowList),
    ...withOptionalSignal(input.signal),
    ...withOptionalOnEvent(input.onEvent),
    ...withOptionalPauseController(input.pauseController),
    ...(input.actionCategories !== undefined ? { actionCategories: input.actionCategories } : {}),
  });
  return {
    targetId: report.targetId,
    bytesDownloaded: report.bytesDownloaded,
    actionsCompleted: report.actionsCompleted,
    actionsSkipped: report.actionsSkipped,
    durationMs: report.durationMs,
  };
};
