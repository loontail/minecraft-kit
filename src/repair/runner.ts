import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import { runInstall } from "../install/runner";
import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import type { HttpClient } from "../types/http";
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
 * console.log(`repaired ${report.actionsCompleted} files in ${report.durationMs}ms`);
 * ```
 */
export const runRepair = async (input: RunRepairInput): Promise<RepairReport> => {
  const report = await runInstall({
    plan: {
      ...input.plan,
      totalActions: input.plan.actions.length,
      totalBytes: input.plan.totalBytes,
    },
    http: input.http,
    cache: input.cache,
    spawner: input.spawner,
    ...withOptionalSignal(input.signal),
    ...withOptionalOnEvent(input.onEvent),
  });
  return {
    targetId: report.targetId,
    bytesDownloaded: report.bytesDownloaded,
    actionsCompleted: report.actionsCompleted,
    durationMs: report.durationMs,
  };
};
