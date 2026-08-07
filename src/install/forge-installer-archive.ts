/**
 * Forge installer-archive reads: pull `install_profile.json` / `version.json` out of the
 * installer JAR and stream the `maven/` embed onto disk under `libraries/`. Pure I/O over
 * the archive — token resolution lives in {@link "./forge-processor-plan"}.
 *
 * @internal
 * @packageDocumentation
 */

import { EXTRACTION_MAX_TOTAL_SIZE } from "../constants/limits";
import {
  assertSafeEntryName,
  openZip,
  readEntryBuffer,
  resolveContainedDestination,
} from "../core/archive";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { atomicWrite } from "../core/fs";
import { isNonEmptyString, isPlainObject } from "../core/guards";
import { parseJsonAs } from "../core/json";
import { mavenRelativePathFor } from "../core/maven";
import { targetPaths } from "../core/paths";
import type {
  ForgeInstallerProfile,
  ForgeInstallProfile,
  ForgeVersionJson,
  LegacyForgeInstallProfile,
} from "../types/forge";

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
 * Light-touch guard for legacy Forge 1.7.x `install_profile.json`.
 *
 * @internal
 */
export const isLegacyForgeInstallProfileShape = (
  value: unknown,
): value is LegacyForgeInstallProfile => {
  if (!isPlainObject(value)) return false;
  if (!isPlainObject(value.install)) return false;
  if (!isForgeVersionJsonShape(value.versionInfo)) return false;
  return (
    isNonEmptyString(value.install.target) &&
    isNonEmptyString(value.install.path) &&
    isNonEmptyString(value.install.filePath) &&
    isNonEmptyString(value.install.minecraft)
  );
};

/**
 * Guard for every Forge installer profile shape the planner supports.
 *
 * @internal
 */
export const isForgeInstallerProfileShape = (value: unknown): value is ForgeInstallerProfile => {
  return isForgeInstallProfileShape(value) || isLegacyForgeInstallProfileShape(value);
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
 * Entry names are archive-controlled, so every destination is resolved through
 * {@link resolveContainedDestination}; the aggregate uncompressed size is capped the same
 * way {@link "../core/archive".extractAllToDir} caps it.
 *
 * Returns the `libraries/`-relative path of every entry written, in archive order, so the caller
 * can record what the flush produced and later check that it is still there.
 *
 * @internal
 */
export const extractInstallerMavenEntries = async (
  installerPath: string,
  directory: string,
): Promise<readonly string[]> => {
  const librariesDir = targetPaths.librariesDir(directory);
  const reader = await openZip(installerPath);
  const written: string[] = [];
  let totalSize = 0;
  try {
    for await (const entry of reader.entries()) {
      if (!entry.name.startsWith("maven/") || entry.isDirectory) continue;
      const relativePath = entry.name.slice("maven/".length);
      const destination = resolveContainedDestination(librariesDir, relativePath);
      totalSize += entry.uncompressedSize;
      if (totalSize > EXTRACTION_MAX_TOTAL_SIZE) {
        throw new MinecraftKitError(
          MinecraftKitErrorCodes.ARCHIVE_TOO_LARGE,
          `Archive total size cap exceeded: ${installerPath}`,
          { context: { filePath: installerPath } },
        );
      }
      const buffer = await entry.readBuffer();
      await atomicWrite(destination, buffer);
      written.push(relativePath);
    }
  } finally {
    reader.close();
  }
  return written;
};

/**
 * Extract the embedded universal jar referenced by a legacy Forge installer to
 * the Maven path expected by the launch classpath builder.
 *
 * Both the entry name (`install.filePath`) and the destination (derived from the
 * `install.path` Maven coordinate, whose `@extension` component can carry separators) come
 * straight out of the installer's own `install_profile.json`, so both are validated before
 * anything is read or written.
 *
 * @internal
 */
export const extractLegacyForgeUniversalJar = async (
  installerPath: string,
  profile: LegacyForgeInstallProfile,
  directory: string,
): Promise<string> => {
  const entryName = profile.install.filePath.startsWith("/")
    ? profile.install.filePath.slice(1)
    : profile.install.filePath;
  assertSafeEntryName(entryName);
  const destination = resolveContainedDestination(
    targetPaths.librariesDir(directory),
    mavenRelativePathFor(profile.install.path),
  );
  const buffer = await readEntryBuffer(installerPath, entryName);
  if (!buffer) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.FORGE_INSTALLER_INVALID,
      `Forge legacy installer is missing required entry: ${entryName}`,
      { context: { filePath: installerPath, entryName } },
    );
  }
  await atomicWrite(destination, buffer);
  return destination;
};
