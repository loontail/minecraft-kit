import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { fileExists, listChildDirectories, readText } from "../core/fs";
import { parseJsonOrUndefined, parseJsonStrict } from "../core/json";
import { mergeManifest } from "../core/manifest-merge";
import { targetPaths } from "../core/paths";
import { Loaders } from "../types/loader";
import type { MinecraftVersionManifest } from "../types/minecraft";
import type { Target } from "../types/target";

/** Result of resolving the on-disk version JSON for a target. */
export type ResolvedLaunchVersion = {
  /** Topmost version id (the one used as `${version_name}` and for the natives directory). */
  readonly versionId: string;
  /** Merged manifest with `inheritsFrom` chain folded together. */
  readonly merged: MinecraftVersionManifest;
  /** Inherits-from chain from top (`versionId`) down to the root vanilla version. */
  readonly chain: readonly string[];
};

/** Read the installed version JSON appropriate for a target's loader and merge inheritsFrom. */
export const resolveLaunchVersion = async (target: Target): Promise<ResolvedLaunchVersion> => {
  if (target.loader.type === Loaders.VANILLA) {
    return {
      versionId: target.minecraft.version,
      merged: target.minecraft.manifest,
      chain: [target.minecraft.version],
    };
  }
  const versionId = await pickInstalledVersionId(target);
  const merged = await loadAndMerge(target.directory, versionId, target.minecraft.manifest);
  // Fabric and modern Forge inherit directly from vanilla — a two-level chain.
  return { versionId, merged, chain: [versionId, target.minecraft.version] };
};

/**
 * Pick the version id whose `versions/<id>/<id>.jar` should land on the launch classpath.
 * Walks the inherits-from chain from top to root and returns the first id whose jar exists
 * on disk. Falls back to the root id when nothing is materialised yet.
 *
 * Why: Fabric's profile id is `fabric-loader-0.14.21-1.20.1`, but Fabric does not produce a
 * matching `.jar`; the loader expects the **vanilla** client jar on the classpath and hooks
 * it via `KnotClient`. Modern Forge similarly leaves `versions/<forge-id>/<forge-id>.jar`
 * absent and routes the patched client jar through `libraries/`. Walking the chain picks
 * the right id for both shapes without special-casing.
 *
 * @internal
 */
export const pickClientJarVersionId = async (
  directory: string,
  chain: readonly string[],
): Promise<string> => {
  for (const id of chain) {
    const jar = targetPaths.versionJar(directory, id);
    if (await fileExists(jar)) return id;
  }
  const fallback = chain.at(-1);
  if (fallback === undefined) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.MANIFEST_NOT_FOUND,
      "Cannot resolve a client jar version id from an empty inheritsFrom chain",
    );
  }
  // Nothing on disk yet — fall back to the root vanilla id so the launch composition still
  // produces a valid path; install/repair will materialise the jar before run-time.
  return fallback;
};

const pickInstalledVersionId = async (target: Target): Promise<string> => {
  if (target.loader.type === Loaders.FABRIC) {
    const candidate = target.loader.profile.id;
    const versionJsonPath = targetPaths.versionJson(target.directory, candidate);
    if (await fileExists(versionJsonPath)) return candidate;
  }
  if (target.loader.type === Loaders.FORGE) {
    const directories = await listChildDirectories(targetPaths.versionsDir(target.directory));
    for (const id of directories) {
      const versionJsonPath = targetPaths.versionJson(target.directory, id);
      if (!(await fileExists(versionJsonPath))) continue;
      const text = await readText(versionJsonPath);
      const parsed = parseJsonOrUndefined<{ inheritsFrom?: string; id?: string }>(text);
      if (
        parsed?.inheritsFrom === target.minecraft.version &&
        (id.includes("forge") || (parsed.id ?? "").includes("forge"))
      ) {
        return id;
      }
    }
  }
  throw new MinecraftKitError(
    MinecraftKitErrorCodes.MANIFEST_NOT_FOUND,
    `Could not find an installed version JSON for target ${target.id}`,
    { context: { targetId: target.id, loaderType: target.loader.type } },
  );
};

const loadAndMerge = async (
  directory: string,
  versionId: string,
  parentManifest: MinecraftVersionManifest,
): Promise<MinecraftVersionManifest> => {
  const versionJsonPath = targetPaths.versionJson(directory, versionId);
  const text = await readText(versionJsonPath);
  const child = parseJsonStrict<MinecraftVersionManifest>(text, {
    code: MinecraftKitErrorCodes.MANIFEST_INVALID,
    message: `Version JSON is not valid JSON: ${versionJsonPath}`,
    context: { filePath: versionJsonPath },
  });
  if (child.inheritsFrom !== undefined && child.inheritsFrom !== parentManifest.id) {
    // Recursive merge through any chain — but in practice Forge/Fabric inherit directly from vanilla.
    return mergeManifest(parentManifest, child);
  }
  return mergeManifest(parentManifest, child);
};
