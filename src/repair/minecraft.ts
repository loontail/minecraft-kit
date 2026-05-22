import { targetPaths } from "../core/paths";
import {
  type DownloadAction,
  DownloadCategories,
  type DownloadCategory,
  type InstallAction,
  InstallActionKinds,
  type WriteVersionJsonAction,
} from "../types/install";
import type { AspectRepairInput, RepairPlan } from "../types/repair";
import { planAspectRepair } from "./helpers";

const MINECRAFT_DOWNLOAD_CATEGORIES = new Set<DownloadCategory>([
  DownloadCategories.CLIENT_JAR,
  DownloadCategories.LIBRARY,
  DownloadCategories.ASSET_INDEX,
  DownloadCategories.ASSET,
  DownloadCategories.LOGGING_CONFIG,
]);

/**
 * Inputs to {@link planMinecraftRepair}. Alias for {@link AspectRepairInput}.
 *
 * @internal
 */
export type PlanMinecraftRepairInput = AspectRepairInput;

/**
 * Build a repair plan covering only the vanilla Minecraft slice: client jar, version JSON,
 * libraries (incl. native jars), assets, logging config, and native extractions.
 */
export const planMinecraftRepair = async (input: PlanMinecraftRepairInput): Promise<RepairPlan> => {
  const vanillaJsonPath = targetPaths.versionJson(
    input.target.directory,
    input.target.minecraft.version,
  );
  return planAspectRepair(input, (action: InstallAction) => {
    if (action.kind === InstallActionKinds.DOWNLOAD_FILE) {
      return MINECRAFT_DOWNLOAD_CATEGORIES.has((action as DownloadAction).category);
    }
    if (action.kind === InstallActionKinds.WRITE_VERSION_JSON) {
      return (action as WriteVersionJsonAction).path === vanillaJsonPath;
    }
    if (action.kind === InstallActionKinds.EXTRACT_NATIVE) {
      return true;
    }
    return false;
  });
};
