import { targetPaths } from "../core/paths";
import {
  DownloadCategories,
  type DownloadCategory,
  type InstallAction,
  InstallActionKinds,
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
 *
 * Prefer `kit.repair.minecraft.plan(target, { from })` over importing this directly.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const verification = await kit.verify.minecraft.run(target);
 * const plan = await kit.repair.minecraft.plan(target, { from: verification });
 * await kit.repair.minecraft.run(plan);
 * ```
 */
export const planMinecraftRepair = async (input: PlanMinecraftRepairInput): Promise<RepairPlan> => {
  const vanillaJsonPath = targetPaths.versionJson(
    input.target.directory,
    input.target.minecraft.version,
  );
  return planAspectRepair(input, (action: InstallAction) => {
    if (action.kind === InstallActionKinds.DOWNLOAD_FILE) {
      return MINECRAFT_DOWNLOAD_CATEGORIES.has(action.category);
    }
    if (action.kind === InstallActionKinds.WRITE_VERSION_JSON) {
      return action.path === vanillaJsonPath;
    }
    if (action.kind === InstallActionKinds.EXTRACT_NATIVE) {
      return true;
    }
    return false;
  });
};
