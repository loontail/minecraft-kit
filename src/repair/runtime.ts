import { DownloadCategories, type InstallAction, InstallActionKinds } from "../types/install";
import type { RepairPlan } from "../types/repair";
import type { AspectRepairInput } from "../types/repair";
import { planAspectRepair } from "./helpers";

/**
 * Inputs to {@link planRuntimeRepair}. Alias for {@link AspectRepairInput}.
 *
 * @internal
 */
export type PlanRuntimeRepairInput = AspectRepairInput;

/**
 * Build a repair plan covering the Java runtime files. `target.runtime.installRoot` is
 * honoured automatically because both `planInstall` and the verify side resolve runtime
 * paths through the same `targetPaths.runtimeRoot(..., installRoot)` helper.
 *
 * Prefer `kit.repair.runtime.plan(target, { from })` over importing this directly.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const verification = await kit.verify.runtime.run(target);
 * const plan = await kit.repair.runtime.plan(target, { from: verification });
 * await kit.repair.runtime.run(plan);
 * ```
 */
export const planRuntimeRepair = async (input: PlanRuntimeRepairInput): Promise<RepairPlan> => {
  return planAspectRepair(
    input,
    (action: InstallAction) =>
      action.kind === InstallActionKinds.DOWNLOAD_FILE &&
      action.category === DownloadCategories.RUNTIME_FILE,
  );
};
