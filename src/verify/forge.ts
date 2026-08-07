import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { readText } from "../core/fs";
import { parseJsonOrUndefined } from "../core/json";
import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import { targetPaths } from "../core/paths";
import { listExtractedInstallerArtifacts } from "../install/forge-install";
import {
  type ForgeProcessorOutput,
  type ForgeProcessorOutputScan,
  ForgeProcessorOutputScanKinds,
  listForgeProcessorOutputs,
} from "../install/forge-processor-outputs";
import { planLibraryDownloads } from "../install/libraries";
import type { ForgeVersionJson } from "../types/forge";
import { DownloadCategories } from "../types/install";
import { Loaders } from "../types/loader";
import {
  type VerificationFileResult,
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
  type VerificationRecorder,
  verifyExistence,
  verifyHashedFiles,
} from "./helpers";

/**
 * Verify the Forge loader slice: the on-disk Forge version JSON, every library it declares, the
 * artifacts flushed out of the installer's `maven/` tree, and the files the Forge processors
 * generate. Libraries can only be enumerated once the JSON is present *and parsable*; a
 * malformed JSON is surfaced as a CORRUPT issue so repair rewrites it before re-running.
 *
 * Stays offline: the processor outputs are read from the installer JAR already on disk.
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
            path: targetPaths.versionJson(input.target.directory, forgeVersionId(loader)),
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
      // why: `findForgeVersionJsonPath` already parsed this file to match `inheritsFrom`, so the
      // only way the parse fails here is a rewrite between the two reads (an install or repair
      // running concurrently). Unreachable from a single-threaded test; kept because the
      // alternative is reading `parsed.libraries` off undefined.
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
      await recordLibraryDownloads(
        record,
        forgeLibraries,
        VerifyFileCategories.LOADER_LIBRARY,
        input.signal,
      );
      const scan = await listForgeProcessorOutputs({
        directory: input.target.directory,
        loader,
        minecraft: input.target.minecraft,
      });
      const generated =
        scan.kind === ForgeProcessorOutputScanKinds.DECLARED ? scan.outputs : ([] as const);
      const covered = new Set([
        ...forgeLibraries.downloads.map((action) => action.target),
        ...generated.map((output) => output.path),
      ]);
      await recordExtractedInstallerArtifacts({
        record,
        directory: input.target.directory,
        fullVersion: loader.fullVersion,
        covered,
        ...withOptionalSignal(input.signal),
      });
      const unreadableInstaller = unreadableInstallerResult(scan);
      if (unreadableInstaller !== undefined) record(unreadableInstaller);
      await recordProcessorOutputs({
        record,
        generated,
        ...withOptionalSignal(input.signal),
      });
    },
  );
};

/**
 * Version id the Forge installer writes under `versions/`, which is *not* `loader.fullVersion`:
 * that one is the Maven version (`1.20.1-47.2.0`) and the installer's `install_profile.json`
 * declares `1.20.1-forge-47.2.0`. Reporting the Maven-shaped path left the issue unmatchable
 * against the install plan's `WRITE_VERSION_JSON` action, so repair never rewrote the missing file.
 * Same `<mc>-forge-<forge>` convention `findForgeVersionJsonPath` scans for.
 */
const forgeVersionId = (loader: { minecraftVersion: string; forgeVersion: string }): string =>
  `${loader.minecraftVersion}-forge-${loader.forgeVersion}`;

/**
 * The installer JAR reported as a broken file when it can no longer say what the processors should
 * have produced. Nothing else in `verify.forge` reads the installer, so staying silent here left
 * the generated artifacts unchecked and the whole target reported clean — the exact state in which
 * repair logs "clean", marks the install ready, and the game dies inside Forge's bootstrap.
 */
const unreadableInstallerResult = (
  scan: ForgeProcessorOutputScan,
): VerificationFileResult | undefined => {
  if (scan.kind === ForgeProcessorOutputScanKinds.DECLARED) return undefined;
  return {
    path: scan.installerPath,
    category: VerifyFileCategories.LOADER_LIBRARY,
    status:
      scan.kind === ForgeProcessorOutputScanKinds.INSTALLER_MISSING
        ? VerifyFileStatuses.MISSING
        : VerifyFileStatuses.CORRUPT,
  };
};

/**
 * Existence-check the artifacts the installer's `maven/` flush put on disk.
 *
 * They belong to the classpath but carry `url: ""`, so `planLibraryDownloads` emits no
 * `DownloadAction` for them and the plan-derived check above cannot see them. Without this, an
 * antivirus quarantine of e.g. `forge-<version>-universal.jar` left `verify.forge` reporting a
 * valid install while launch died on a missing classpath entry. Only existence is checked: Forge
 * publishes no hash or size for embedded artifacts. Re-planning the install re-extracts whatever
 * is reported missing here.
 */
const recordExtractedInstallerArtifacts = async (input: {
  readonly record: VerificationRecorder;
  readonly directory: string;
  readonly fullVersion: string;
  /** Paths already checked with a hash by another step; existence-only would be a downgrade. */
  readonly covered: ReadonlySet<string>;
  readonly signal?: AbortSignal;
}): Promise<void> => {
  const extracted = await listExtractedInstallerArtifacts(input.directory, input.fullVersion);
  await verifyHashedFiles(
    input.record,
    extracted
      .filter((filePath) => !input.covered.has(filePath))
      .map((filePath) => ({
        path: filePath,
        category: VerifyFileCategories.LOADER_LIBRARY,
      })),
    input.signal,
  );
};

/**
 * Hash-check the artifacts the Forge processors generate locally.
 *
 * `install_profile.json` declares a SHA-1 for most of them, but nothing downloads them, so they
 * appear in no `DownloadAction` and the plan-derived scan above cannot see them. Without this, a
 * truncated `<mc>-srg.jar` — the state a cancelled or crashed install leaves behind — read as a
 * valid Forge install and only surfaced as a launch-time crash inside Forge's bootstrap.
 * `repair.forge` maps an issue reported here back to the processor that produces the file.
 *
 * An output the profile publishes no digest for is existence-checked, the same downgrade
 * {@link recordExtractedInstallerArtifacts} makes for `url: ""` artifacts. Dropping it instead
 * cost it every check it could have had.
 */
const recordProcessorOutputs = async (input: {
  readonly record: VerificationRecorder;
  readonly generated: readonly ForgeProcessorOutput[];
  readonly signal?: AbortSignal;
}): Promise<void> => {
  await verifyHashedFiles(
    input.record,
    input.generated.map((output) => ({
      path: output.path,
      ...(output.sha1 !== undefined ? { expectedSha1: output.sha1 } : {}),
      category: VerifyFileCategories.FORGE_PROCESSOR_OUTPUT,
    })),
    input.signal,
  );
};
