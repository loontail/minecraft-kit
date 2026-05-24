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
import { parseJsonStrict } from "../core/json";
import { targetPaths } from "../core/paths";

/**
 * Read a single JSON entry from the installer JAR. Throws `FORGE_INSTALLER_INVALID`
 * with the entry name in context when the entry is missing or not valid JSON.
 *
 * @internal
 */
export const readJsonEntry = async <T>(zipPath: string, entryName: string): Promise<T> => {
  const buffer = await readEntryBuffer(zipPath, entryName);
  if (!buffer) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.FORGE_INSTALLER_INVALID,
      `Forge installer is missing required entry: ${entryName}`,
      { context: { filePath: zipPath, entryName } },
    );
  }
  return parseJsonStrict<T>(buffer.toString("utf8"), {
    code: MinecraftKitErrorCodes.FORGE_INSTALLER_INVALID,
    message: `Forge installer entry is not valid JSON: ${entryName}`,
    context: { filePath: zipPath, entryName },
  });
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
