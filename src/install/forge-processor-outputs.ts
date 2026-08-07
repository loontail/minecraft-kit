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
  readonly sha1: string;
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
 * that is absent, unreadable, or malformed yields an empty list rather than an error — a target in
 * that state has bigger problems, and they are already reported by the version-JSON and library
 * checks (and by the install/repair path, which reads the same archive and does throw).
 *
 * @internal
 */
export const listForgeProcessorOutputs = async (input: {
  readonly directory: string;
  readonly loader: ResolvedForgeLoader;
  readonly minecraft: ResolvedMinecraft;
}): Promise<readonly ForgeProcessorOutput[]> => {
  const installerPath = targetPaths.forgeInstaller(input.directory, input.loader.fullVersion);
  if (!(await fileExists(installerPath))) return [];
  try {
    return await readDeclaredOutputs(installerPath, input);
  } catch {
    return [];
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

  const byPath = new Map<string, string>();
  for (const action of actions) {
    for (const [outputPath, sha1] of Object.entries(action.outputs)) {
      // A processor may declare an output with no publishable hash; existence alone is checked
      // by the processor runner at install time and cannot be re-checked here.
      if (SHA1_PATTERN.test(sha1)) byPath.set(outputPath, sha1);
    }
  }
  return [...byPath].map(([outputPath, sha1]) => ({ path: outputPath, sha1 }));
};
