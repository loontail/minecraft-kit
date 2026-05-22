import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { targetPaths } from "../core/paths";
import {
  type DownloadAction,
  DownloadCategories,
  type DownloadCategory,
  type InstallAction,
  InstallActionKinds,
  type WriteVersionJsonAction,
} from "../types/install";
import { Loaders } from "../types/loader";
import type { AspectRepairInput, RepairPlan } from "../types/repair";
import { planAspectRepair } from "./helpers";

const FORGE_DOWNLOAD_CATEGORIES = new Set<DownloadCategory>([
  DownloadCategories.FORGE_LIBRARY,
  DownloadCategories.FORGE_INSTALLER,
]);

/**
 * Inputs to {@link planForgeRepair}. Alias for {@link AspectRepairInput}.
 *
 * @internal
 */
export type PlanForgeRepairInput = AspectRepairInput;

/**
 * Build a repair plan covering the Forge loader slice: version JSON, libraries, installer
 * download, and the Forge processors that produce the final installation. When the Forge
 * version JSON was missing during verify (so libraries couldn't be enumerated), every
 * forge-library download is added defensively — `downloadFile` skips files already on disk.
 */
export const planForgeRepair = async (input: PlanForgeRepairInput): Promise<RepairPlan> => {
  if (input.target.loader.type !== Loaders.FORGE) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `repair.forge requires a Forge target (got ${input.target.loader.type})`,
    );
  }
  const forgeJsonPath = targetPaths.versionJson(
    input.target.directory,
    input.target.loader.fullVersion,
  );

  return planAspectRepair(
    input,
    (action: InstallAction) => {
      if (action.kind === InstallActionKinds.DOWNLOAD_FILE) {
        return FORGE_DOWNLOAD_CATEGORIES.has((action as DownloadAction).category);
      }
      if (action.kind === InstallActionKinds.WRITE_VERSION_JSON) {
        return (action as WriteVersionJsonAction).path === forgeJsonPath;
      }
      // Processors handled in the postprocess step (only when JSON was missing).
      return false;
    },
    ({ actions, installPlan, issues }) => {
      if (!issues.has(forgeJsonPath)) return;
      // Forge JSON was missing during verify → libraries couldn't be enumerated. Include
      // every forge-library download (skip-on-correct keeps this cheap) plus the processors
      // that regenerate the JSON.
      const alreadyIncluded = new Set(
        actions
          .filter((a): a is DownloadAction => a.kind === InstallActionKinds.DOWNLOAD_FILE)
          .map((a) => a.target),
      );
      for (const action of installPlan.actions) {
        if (
          action.kind === InstallActionKinds.DOWNLOAD_FILE &&
          (action as DownloadAction).category === DownloadCategories.FORGE_LIBRARY &&
          !alreadyIncluded.has((action as DownloadAction).target)
        ) {
          actions.push(action);
        } else if (action.kind === InstallActionKinds.RUN_FORGE_PROCESSOR) {
          actions.push(action);
        }
      }
    },
  );
};
