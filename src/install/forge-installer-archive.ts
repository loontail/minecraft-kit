/**
 * Forge installer-archive reads: pull `install_profile.json` / `version.json` out of the
 * installer JAR and stream the `maven/` embed onto disk under `libraries/`. Pure I/O over
 * the archive — token resolution lives in {@link "./forge-processor-plan"}.
 *
 * @internal
 * @packageDocumentation
 */

import path from "node:path";
import { openZip, readEntryBuffer } from "../core/archive";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { atomicWrite } from "../core/fs";
import { isNonEmptyString, isPlainObject } from "../core/guards";
import { parseJsonAs } from "../core/json";
import { targetPaths } from "../core/paths";
import type { ForgeInstallProfile, ForgeVersionJson } from "../types/forge";

/**
 * Read a single JSON entry from the installer JAR. Throws `FORGE_INSTALLER_INVALID`
 * with the entry name in context when the entry is missing, not valid JSON, or
 * fails the `guard` shape check.
 *
 * @internal
 */
export const readJsonEntry = async <T>(
  zipPath: string,
  entryName: string,
  guard: (value: unknown) => value is T,
): Promise<T> => {
  const buffer = await readEntryBuffer(zipPath, entryName);
  if (!buffer) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.FORGE_INSTALLER_INVALID,
      `Forge installer is missing required entry: ${entryName}`,
      { context: { filePath: zipPath, entryName } },
    );
  }
  return parseJsonAs<T>(buffer.toString("utf8"), guard, {
    code: MinecraftKitErrorCodes.FORGE_INSTALLER_INVALID,
    message: `Forge installer entry has an unexpected shape: ${entryName}`,
    context: { filePath: zipPath, entryName },
  });
};

/**
 * Light-touch guard for the Forge `install_profile.json` (spec 1) shape. Checks
 * the fields the planner reads (`spec`, `json`, `data`, `libraries`,
 * `processors`) and minimal per-processor shape (`jar`, `args`, `classpath`).
 *
 * @internal
 */
export const isForgeInstallProfileShape = (value: unknown): value is ForgeInstallProfile => {
  if (!isPlainObject(value)) return false;
  if (typeof value.spec !== "number") return false;
  if (!isNonEmptyString(value.json)) return false;
  if (!isPlainObject(value.data)) return false;
  if (!Array.isArray(value.libraries)) return false;
  if (!Array.isArray(value.processors)) return false;
  for (const processor of value.processors) {
    if (!isPlainObject(processor)) return false;
    if (!isNonEmptyString(processor.jar)) return false;
    if (!Array.isArray(processor.args)) return false;
    if (!Array.isArray(processor.classpath)) return false;
  }
  return true;
};

/**
 * Light-touch guard for the `version.json` entry shipped inside the Forge
 * installer JAR. Checks `id`, `mainClass`, `inheritsFrom` (all strings) and
 * `libraries[]` is an array of `{ name: string }`.
 *
 * @internal
 */
export const isForgeVersionJsonShape = (value: unknown): value is ForgeVersionJson => {
  if (!isPlainObject(value)) return false;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.mainClass) ||
    !isNonEmptyString(value.inheritsFrom)
  ) {
    return false;
  }
  if (!Array.isArray(value.libraries)) return false;
  for (const lib of value.libraries) {
    if (!isPlainObject(lib) || !isNonEmptyString(lib.name)) return false;
  }
  return true;
};

/**
 * Stream every `maven/<relative-path>` entry from the installer JAR into the target's
 * `libraries/` directory. Used by {@link "./forge-install".planForgeInstall} to flush the
 * embedded artifacts before processor invocation; downstream `DOWNLOAD_FILE` actions then
 * skip these paths because the on-disk hash already matches.
 *
 * @internal
 */
export const extractInstallerMavenEntries = async (
  installerPath: string,
  directory: string,
): Promise<void> => {
  const reader = await openZip(installerPath);
  try {
    for await (const entry of reader.entries()) {
      if (!entry.name.startsWith("maven/") || entry.isDirectory) continue;
      const relativeWithinLibraries = entry.name.slice("maven/".length);
      const destination = path.join(targetPaths.librariesDir(directory), relativeWithinLibraries);
      const buffer = await entry.readBuffer();
      await atomicWrite(destination, buffer);
    }
  } finally {
    reader.close();
  }
};
