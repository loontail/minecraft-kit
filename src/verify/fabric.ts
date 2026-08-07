import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import { targetPaths } from "../core/paths";
import { planLibraryDownloads } from "../install/libraries";
import { DownloadCategories } from "../types/install";
import { Loaders } from "../types/loader";
import {
  VerificationKinds,
  type VerificationResult,
  type VerifyAspectInput,
  VerifyFileCategories,
} from "../types/verify";
import { recordLibraryDownloads, runVerification, verifyExistence } from "./helpers";

/**
 * Verify the Fabric loader slice: profile JSON + every library it pulls in.
 *
 * Throws `INVALID_INPUT` when the target is not a Fabric install.
 *
 * Prefer `kit.verify.fabric.run(target)` over importing this directly.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const result = await kit.verify.fabric.run(fabricTarget);
 * if (!result.isValid) {
 *   const plan = await kit.repair.fabric.plan(fabricTarget, { from: result });
 *   await kit.repair.fabric.run(plan);
 * }
 * ```
 */
export const verifyFabric = async (input: VerifyAspectInput): Promise<VerificationResult> => {
  if (input.target.loader.type !== Loaders.FABRIC) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `verify.fabric requires a Fabric target (got ${input.target.loader.type})`,
    );
  }
  const loader = input.target.loader;
  return runVerification(
    {
      targetId: input.target.id,
      kind: VerificationKinds.FABRIC,
      ...withOptionalOnEvent(input.onEvent),
      ...withOptionalSignal(input.signal),
    },
    async (record) => {
      record(
        await verifyExistence({
          path: targetPaths.versionJson(input.target.directory, loader.profile.id),
          category: VerifyFileCategories.LOADER_LIBRARY,
        }),
      );
      const fabricLibraries = planLibraryDownloads({
        libraries: loader.profile.libraries,
        directory: input.target.directory,
        system: input.target.runtime.system,
        versionId: input.target.minecraft.version,
        category: DownloadCategories.FABRIC_LIBRARY,
      });
      await recordLibraryDownloads(
        record,
        fabricLibraries,
        VerifyFileCategories.LOADER_LIBRARY,
        input.signal,
      );
    },
  );
};
