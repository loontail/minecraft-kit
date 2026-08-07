/**
 * The files a Forge install's processors are expected to leave on disk, with the SHA-1
 * `install_profile.json` declares for each. Derived from the installer JAR already on disk, so
 * `verify` can check generated artifacts without a network round-trip or an install plan.
 *
 * @internal
 * @packageDocumentation
 */

import { fileExists } from "../core/fs";
import { targetPaths } from "../core/paths";
import type { ForgeInstallerProfile, ResolvedForgeLoader } from "../types/forge";
import type { ResolvedMinecraft } from "../types/minecraft";
import {
  isForgeInstallerProfileShape,
  isLegacyForgeInstallProfileShape,
  readJsonEntry,
} from "./forge-installer-archive";
import { buildProcessorActions, resolveProfileData } from "./forge-processor-plan";

/**
 * One declared processor output: where it lands and the SHA-1 the installer promises for it.
 *
 * @internal
 */
export type ForgeProcessorOutput = {
  readonly path: string;
  /**
   * Absent when the profile publishes no digest for this output — its `{..._SHA}` token resolved
   * to an empty string. Existence is then the only check available for it.
   */
  readonly sha1?: string;
};

/**
 * Outcome kinds of {@link listForgeProcessorOutputs}.
 *
 * @internal
 */
export const ForgeProcessorOutputScanKinds = {
  /** The profile was read: `outputs` is complete, and empty means "this Forge generates nothing". */
  DECLARED: "declared",
  /** No installer JAR on disk, so nothing declares what the processors should have produced. */
  INSTALLER_MISSING: "installer-missing",
  /** The installer JAR is on disk but truncated, not an archive, or malformed past the profile. */
  INSTALLER_UNREADABLE: "installer-unreadable",
} as const;

/**
 * Scan outcome kind literal.
 *
 * @internal
 */
export type ForgeProcessorOutputScanKind =
  (typeof ForgeProcessorOutputScanKinds)[keyof typeof ForgeProcessorOutputScanKinds];

/**
 * Either the declared outputs or the reason they could not be determined. The two are kept
 * distinguishable on purpose: an empty list and "cannot tell" produce very different verdicts, and
 * collapsing them into `[]` is what let a broken install verify clean.
 *
 * @internal
 */
export type ForgeProcessorOutputScan =
  | {
      readonly kind: typeof ForgeProcessorOutputScanKinds.DECLARED;
      readonly outputs: readonly ForgeProcessorOutput[];
    }
  | {
      readonly kind:
        | typeof ForgeProcessorOutputScanKinds.INSTALLER_MISSING
        | typeof ForgeProcessorOutputScanKinds.INSTALLER_UNREADABLE;
      readonly installerPath: string;
    };

const SHA1_PATTERN = /^[0-9a-f]{40}$/i;

/**
 * Expected outputs of every client-side processor for this Forge version.
 *
 * These are generated artifacts — the srg/slim/extra/patched client JARs — so they appear in no
 * `DownloadAction` and in no `libraries` entry with a usable URL. Without this list a Forge
 * install whose `<mc>-srg.jar` was truncated, quarantined, or left half-written by a cancelled
 * install verifies as valid and then dies at launch.
 *
 * Reads only the installer JAR (`install_profile.json` + its `data[*]` token table) and never
 * downloads, extracts, or writes: `verify` must stay offline and side-effect-free. An installer
 * that is absent or unreadable is reported as such rather than thrown or flattened to an empty
 * list — nothing else in `verify.forge` looks at the installer, so the caller is the only place
 * that can turn "the generated artifacts are unknowable" into a reportable issue.
 *
 * @internal
 */
export const listForgeProcessorOutputs = async (input: {
  readonly directory: string;
  readonly loader: ResolvedForgeLoader;
  readonly minecraft: ResolvedMinecraft;
}): Promise<ForgeProcessorOutputScan> => {
  const installerPath = targetPaths.forgeInstaller(input.directory, input.loader.fullVersion);
  if (!(await fileExists(installerPath))) {
    return { kind: ForgeProcessorOutputScanKinds.INSTALLER_MISSING, installerPath };
  }
  try {
    return {
      kind: ForgeProcessorOutputScanKinds.DECLARED,
      outputs: await readDeclaredOutputs(installerPath, input),
    };
  } catch {
    return { kind: ForgeProcessorOutputScanKinds.INSTALLER_UNREADABLE, installerPath };
  }
};

const readDeclaredOutputs = async (
  installerPath: string,
  input: {
    readonly directory: string;
    readonly minecraft: ResolvedMinecraft;
  },
): Promise<readonly ForgeProcessorOutput[]> => {
  const profile = await readJsonEntry<ForgeInstallerProfile>(
    installerPath,
    "install_profile.json",
    isForgeInstallerProfileShape,
  );
  // 1.7.x profiles have no processors: the universal JAR ships prebuilt inside the installer.
  if (isLegacyForgeInstallProfileShape(profile)) return [];

  const dataResolved = await resolveProfileData({
    profile,
    installerPath,
    directory: input.directory,
    entryExtraction: "skip",
  });
  const actions = await buildProcessorActions({
    profile,
    minecraft: input.minecraft,
    installerPath,
    directory: input.directory,
    dataResolved,
  });

  const byPath = new Map<string, string | undefined>();
  for (const action of actions) {
    for (const [outputPath, sha1] of Object.entries(action.outputs)) {
      // why: a hash the profile does not publish must not be compared against — the digest of a
      // correct file never equals "", so the output would fail verification forever and re-run its
      // processor on every repair. It still gets an existence check downstream.
      const usable = SHA1_PATTERN.test(sha1) ? sha1 : undefined;
      // why not a plain set: the same output path can be declared by more than one processor, and
      // last-write-wins let a later hashless declaration erase a real digest that an earlier one
      // published — downgrading that file from "verify the contents" to "check it exists", which is
      // exactly the silent fail-open this function was fixed to stop doing. A published hash always
      // wins, whatever order the profile lists the processors in.
      if (usable === undefined && byPath.get(outputPath) !== undefined) continue;
      byPath.set(outputPath, usable);
    }
  }
  return [...byPath].map(([outputPath, sha1]) => ({
    path: outputPath,
    ...(sha1 !== undefined ? { sha1 } : {}),
  }));
};
