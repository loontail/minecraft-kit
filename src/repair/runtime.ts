import {
  type DownloadAction,
  DownloadCategories,
  type InstallAction,
  InstallActionKinds,
} from "../types/install";
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
 */
export const planRuntimeRepair = async (input: PlanRuntimeRepairInput): Promise<RepairPlan> => {
  return planAspectRepair(
    input,
    (action: InstallAction) =>
      action.kind === InstallActionKinds.DOWNLOAD_FILE &&
      (action as DownloadAction).category === DownloadCategories.RUNTIME_FILE,
  );
};
