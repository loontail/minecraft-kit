import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { readText } from "../core/fs";
import { parseJsonOrUndefined } from "../core/json";
import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import { targetPaths } from "../core/paths";
import { planLibraryDownloads } from "../install/libraries";
import type { ForgeVersionJson } from "../types/forge";
import { DownloadCategories } from "../types/install";
import { Loaders } from "../types/loader";
import {
  VerificationKinds,
  type VerificationResult,
  type VerifyAspectInput,
  VerifyFileCategories,
  VerifyFileStatuses,
} from "../types/verify";
import {
  findForgeVersionJsonPath,
  recordLibraryDownloads,
  runVerification,
  verifyExistence,
} from "./helpers";

/**
 * Verify the Forge loader slice: the on-disk Forge version JSON and every library it
 * declares. Libraries can only be enumerated once the JSON is present *and parsable*; a
 * malformed JSON is surfaced as a CORRUPT issue so repair rewrites it before re-running.
 *
 * Throws `INVALID_INPUT` when the target is not a Forge install.
 *
 * Prefer `kit.verify.forge.run(target)` over importing this directly.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const result = await kit.verify.forge.run(forgeTarget);
 * for (const issue of result.issues) console.log(issue.status, issue.path);
 * ```
 */
export const verifyForge = async (input: VerifyAspectInput): Promise<VerificationResult> => {
  if (input.target.loader.type !== Loaders.FORGE) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `verify.forge requires a Forge target (got ${input.target.loader.type})`,
    );
  }
  const loader = input.target.loader;
  return runVerification(
    {
      targetId: input.target.id,
      kind: VerificationKinds.FORGE,
      ...withOptionalOnEvent(input.onEvent),
      ...withOptionalSignal(input.signal),
    },
    async (record) => {
      const forgeVersionJsonPath = await findForgeVersionJsonPath(
        input.target.directory,
        input.target.minecraft.version,
      );
      if (forgeVersionJsonPath === null) {
        record(
          await verifyExistence({
            path: targetPaths.versionJson(input.target.directory, loader.fullVersion),
            category: VerifyFileCategories.LOADER_LIBRARY,
          }),
        );
        return;
      }
      const existence = await verifyExistence({
        path: forgeVersionJsonPath,
        category: VerifyFileCategories.LOADER_LIBRARY,
      });
      record(existence);
      if (existence.status !== VerifyFileStatuses.OK) return;

      const parsed = parseJsonOrUndefined<ForgeVersionJson>(await readText(forgeVersionJsonPath));
      if (parsed === undefined) {
        record({
          path: forgeVersionJsonPath,
          category: VerifyFileCategories.LOADER_LIBRARY,
          status: VerifyFileStatuses.CORRUPT,
        });
        return;
      }
      const forgeLibraries = planLibraryDownloads({
        libraries: parsed.libraries,
        directory: input.target.directory,
        system: input.target.runtime.system,
        versionId: input.target.minecraft.version,
        category: DownloadCategories.FORGE_LIBRARY,
      });
      await recordLibraryDownloads(record, forgeLibraries, VerifyFileCategories.LOADER_LIBRARY);
    },
  );
};
