/**
 * Network-free "can this target launch right now?" check. Composes the launch file set
 * locally (java executable, resolved version JSON, client jar, classpath) and reports which
 * launch-critical files are missing — without fetching manifests or SHA-1-hashing anything,
 * so it is cheap enough to gate every launch.
 *
 * @internal
 * @packageDocumentation
 */

import { dedupe } from "../core/collections";
import { MinecraftKitErrorCodes, isMinecraftKitError } from "../core/errors";
import { fileExists } from "../core/fs";
import { targetPaths } from "../core/paths";
import { asMinecraftVersionId } from "../core/version-id";
import type { LaunchPreflightResult } from "../types/launch";
import { Loaders } from "../types/loader";
import type { Target } from "../types/target";
import { buildClasspath } from "./classpath";
import { pickClientJarVersionId, resolveLaunchVersion } from "./version-resolution";

/**
 * Check, without any network access, whether a target has every launch-critical file on disk.
 *
 * @internal
 */
export const launchPreflight = async (target: Target): Promise<LaunchPreflightResult> => {
  const required: string[] = [
    targetPaths.runtimeJavaExecutable(
      target.directory,
      target.runtime.component,
      target.runtime.system.os,
      target.runtime.installRoot,
    ),
  ];

  required.push(...(await collectVersionFiles(target)));

  const missing: string[] = [];
  for (const filePath of dedupe(required)) {
    if (!(await fileExists(filePath))) missing.push(filePath);
  }
  return { ok: missing.length === 0, missing };
};

/**
 * Resolve the version chain locally and return the version JSON, client jar, and classpath
 * entries it implies. A missing loader version JSON makes {@link resolveLaunchVersion} throw
 * `MANIFEST_NOT_FOUND`; treat that as a missing launch-critical file (the expected loader
 * version JSON path) rather than a hard error, so the caller still gets an actionable list.
 */
const collectVersionFiles = async (target: Target): Promise<readonly string[]> => {
  let resolved: Awaited<ReturnType<typeof resolveLaunchVersion>>;
  try {
    resolved = await resolveLaunchVersion(target);
  } catch (error) {
    if (isMinecraftKitError(error) && error.code === MinecraftKitErrorCodes.MANIFEST_NOT_FOUND) {
      return [expectedLoaderVersionJson(target)];
    }
    throw error;
  }

  const clientJarVersionId = await pickClientJarVersionId(target.directory, resolved.chain);
  const classpath = buildClasspath({
    directory: target.directory,
    versionId: clientJarVersionId,
    merged: resolved.merged,
    system: target.runtime.system,
  });
  return [targetPaths.versionJson(target.directory, resolved.versionId), ...classpath];
};

/**
 * Best-effort path of the loader version JSON whose absence made resolution fail, so a failed
 * resolve still surfaces a concrete missing file. Mirrors the install/repair layout: Fabric
 * writes the profile id, Forge the full version, vanilla the Minecraft version.
 */
const expectedLoaderVersionJson = (target: Target): string => {
  if (target.loader.type === Loaders.FABRIC) {
    return targetPaths.versionJson(
      target.directory,
      asMinecraftVersionId(target.loader.profile.id),
    );
  }
  if (target.loader.type === Loaders.FORGE) {
    return targetPaths.versionJson(target.directory, target.loader.fullVersion);
  }
  return targetPaths.versionJson(target.directory, target.minecraft.version);
};
