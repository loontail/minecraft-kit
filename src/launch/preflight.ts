/**
 * Network-free "can this target launch right now?" check. Composes the launch file set
 * locally (java executable, resolved version JSON, client jar, classpath) and reports which
 * launch-critical files are missing — without fetching manifests or SHA-1-hashing anything,
 * so it is cheap enough to gate every launch.
 *
 * @internal
 * @packageDocumentation
 */

import { isMinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { fileExists } from "../core/fs";
import { targetPaths } from "../core/paths";
import { asMinecraftVersionId } from "../core/version-id";
import type { LaunchPreflightResult } from "../types/launch";
import { Loaders } from "../types/loader";
import type { Target } from "../types/target";
import type { TargetReadinessIssue } from "../types/verify";
import { VerificationKinds, VerifyFileCategories, VerifyFileStatuses } from "../types/verify";
import { buildClasspath } from "./classpath";
import { pickClientJarVersionId, resolveLaunchVersion } from "./version-resolution";

/** A launch-critical file plus the verify aspect and category it would be reported under. */
type RequiredFile = {
  readonly path: string;
  readonly category: TargetReadinessIssue["category"];
  readonly kind: TargetReadinessIssue["kind"];
};

/**
 * Check, without any network access, whether a target has every launch-critical file on disk.
 *
 * @internal
 */
export const launchPreflight = async (target: Target): Promise<LaunchPreflightResult> => {
  const startedAt = Date.now();
  const required: RequiredFile[] = [
    {
      path: targetPaths.runtimeJavaExecutable(
        target.directory,
        target.runtime.component,
        target.runtime.system.os,
        target.runtime.installRoot,
      ),
      category: VerifyFileCategories.RUNTIME_FILE,
      kind: VerificationKinds.RUNTIME,
    },
  ];

  required.push(...(await collectVersionFiles(target)));

  const issues: TargetReadinessIssue[] = [];
  const seen = new Set<string>();
  for (const file of required) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    if (await fileExists(file.path)) continue;
    issues.push({
      path: file.path,
      category: file.category,
      kind: file.kind,
      status: VerifyFileStatuses.MISSING,
    });
  }
  return {
    targetId: target.id,
    isReady: issues.length === 0,
    issues,
    durationMs: Date.now() - startedAt,
  };
};

/** The verify aspect that owns a target's loader files. */
const loaderKind = (target: Target): TargetReadinessIssue["kind"] => {
  if (target.loader.type === Loaders.FABRIC) return VerificationKinds.FABRIC;
  if (target.loader.type === Loaders.FORGE) return VerificationKinds.FORGE;
  return VerificationKinds.MINECRAFT;
};

/**
 * Resolve the version chain locally and return the version JSON, client jar, and classpath
 * entries it implies. A missing loader version JSON makes {@link resolveLaunchVersion} throw
 * `MANIFEST_NOT_FOUND`; treat that as a missing launch-critical file (the expected loader
 * version JSON path) rather than a hard error, so the caller still gets an actionable list.
 */
const collectVersionFiles = async (target: Target): Promise<readonly RequiredFile[]> => {
  let resolved: Awaited<ReturnType<typeof resolveLaunchVersion>>;
  try {
    resolved = await resolveLaunchVersion(target);
  } catch (error) {
    if (isMinecraftKitError(error) && error.code === MinecraftKitErrorCodes.MANIFEST_NOT_FOUND) {
      return [
        {
          path: expectedLoaderVersionJson(target),
          category: VerifyFileCategories.LOADER_LIBRARY,
          kind: loaderKind(target),
        },
      ];
    }
    throw error;
  }

  const clientJarVersionId = await pickClientJarVersionId(target.directory, resolved.chain);
  const versionJar = targetPaths.versionJar(target.directory, clientJarVersionId);
  const classpath = buildClasspath({
    directory: target.directory,
    versionId: clientJarVersionId,
    merged: resolved.merged,
    system: target.runtime.system,
  });
  return [
    {
      path: targetPaths.versionJson(target.directory, resolved.versionId),
      category: VerifyFileCategories.CLIENT_JAR,
      kind: VerificationKinds.MINECRAFT,
    },
    ...classpath.map((entry) => ({
      path: entry,
      category:
        entry === versionJar ? VerifyFileCategories.CLIENT_JAR : VerifyFileCategories.LIBRARY,
      kind: VerificationKinds.MINECRAFT,
    })),
  ];
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
