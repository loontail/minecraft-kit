import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { targetPaths } from "../core/paths";
import {
  type DownloadAction,
  DownloadCategories,
  type InstallAction,
  InstallActionKinds,
  type WriteVersionJsonAction,
} from "../types/install";
import { Loaders } from "../types/loader";
import type { RepairPlan } from "../types/repair";
import type { AspectRepairInput } from "../types/repair";
import { planAspectRepair } from "./helpers";

/**
 * Inputs to {@link planFabricRepair}. Alias for {@link AspectRepairInput}; consumers calling
 * the standalone planner can use either name.
 *
 * @internal
 */
export type PlanFabricRepairInput = AspectRepairInput;

/**
 * Build a repair plan covering the Fabric loader slice: profile JSON + libraries.
 *
 * Throws `INVALID_INPUT` when the target is not a Fabric install.
 *
 * Prefer `kit.repair.fabric.plan(target, { from })` over importing this directly.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const verification = await kit.verify.fabric.run(fabricTarget);
 * const plan = await kit.repair.fabric.plan(fabricTarget, { from: verification });
 * await kit.repair.fabric.run(plan);
 * ```
 */
export const planFabricRepair = async (input: PlanFabricRepairInput): Promise<RepairPlan> => {
  if (input.target.loader.type !== Loaders.FABRIC) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `repair.fabric requires a Fabric target (got ${input.target.loader.type})`,
    );
  }
  const fabricJsonPath = targetPaths.versionJson(
    input.target.directory,
    input.target.loader.profile.id,
  );
  return planAspectRepair(input, (action: InstallAction) => {
    if (action.kind === InstallActionKinds.DOWNLOAD_FILE) {
      return (action as DownloadAction).category === DownloadCategories.FABRIC_LIBRARY;
    }
    if (action.kind === InstallActionKinds.WRITE_VERSION_JSON) {
      return (action as WriteVersionJsonAction).path === fabricJsonPath;
    }
    return false;
  });
};
