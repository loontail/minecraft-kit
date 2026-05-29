import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import { targetPaths } from "../core/paths";
import { pickPrimaryDownloadUrl } from "../http/download";
import { planLibraryDownloads } from "../install/libraries";
import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import type { HttpClient } from "../types/http";
import { DownloadCategories } from "../types/install";
import { Loaders } from "../types/loader";
import type { Target } from "../types/target";
import { VerificationKinds, type VerificationResult, VerifyFileCategories } from "../types/verify";
import { runVerification, verifyExistence, verifyHashedFile } from "./helpers";

/**
 * Inputs to {@link verifyFabric}.
 *
 * @internal
 */
export type VerifyFabricInput = {
  readonly target: Target;
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly signal?: AbortSignal;
  readonly onEvent?: ProgressListener;
};

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
export const verifyFabric = async (input: VerifyFabricInput): Promise<VerificationResult> => {
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
      for (const action of fabricLibraries.downloads) {
        record(
          await verifyHashedFile({
            path: action.target,
            ...(action.expectedSha1 !== undefined ? { expectedSha1: action.expectedSha1 } : {}),
            ...(action.expectedSize !== undefined ? { expectedSize: action.expectedSize } : {}),
            url: pickPrimaryDownloadUrl(action.url),
            category: VerifyFileCategories.LOADER_LIBRARY,
          }),
        );
      }
    },
  );
};
