import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { fileExists, listChildDirectories, readText } from "../core/fs";
import { parseJsonOrUndefined, parseJsonStrict } from "../core/json";
import { mergeManifest } from "../core/manifest-merge";
import { targetPaths } from "../core/paths";
import { asMinecraftVersionId } from "../core/version-id";
import { Loaders } from "../types/loader";
import type { MinecraftVersionId, MinecraftVersionManifest } from "../types/minecraft";
import type { Target } from "../types/target";

/**
 * Result of resolving the on-disk version JSON for a target.
 *
 * @example
 * ```ts
 * import { resolveLaunchVersion, type ResolvedLaunchVersion } from "@loontail/minecraft-kit";
 *
 * const resolved: ResolvedLaunchVersion = await resolveLaunchVersion(target);
 * console.log(resolved.versionId, resolved.chain);
 * console.log(resolved.merged.mainClass);
 * ```
 */
export type ResolvedLaunchVersion = {
  /** Topmost version id (the one used as `${version_name}` and for the natives directory). */
  readonly versionId: MinecraftVersionId;
  /** Merged manifest with `inheritsFrom` chain folded together. */
  readonly merged: MinecraftVersionManifest;
  /** Inherits-from chain from top (`versionId`) down to the root vanilla version. */
  readonly chain: readonly MinecraftVersionId[];
};

/**
 * Read the installed version JSON appropriate for a target's loader and merge inheritsFrom.
 *
 * `kit.launch.compose` calls this internally; reach for it directly when you need the merged
 * manifest (or the inheritsFrom chain) without composing a full JVM invocation.
 *
 * @example
 * ```ts
 * import { resolveLaunchVersion } from "@loontail/minecraft-kit";
 *
 * const { merged, versionId, chain } = await resolveLaunchVersion(target);
 * console.log(`launching ${versionId} → ${chain.join(" → ")} via ${merged.mainClass}`);
 * ```
 */
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
  chain: readonly MinecraftVersionId[],
): Promise<MinecraftVersionId> => {
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
  return fallback;
};

const pickInstalledVersionId = async (target: Target): Promise<MinecraftVersionId> => {
  if (target.loader.type === Loaders.FABRIC) {
    const candidate = asMinecraftVersionId(target.loader.profile.id);
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
        return asMinecraftVersionId(id);
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
  versionId: MinecraftVersionId,
  parentManifest: MinecraftVersionManifest,
): Promise<MinecraftVersionManifest> => {
  const versionJsonPath = targetPaths.versionJson(directory, versionId);
  const text = await readText(versionJsonPath);
  const child = parseJsonStrict<MinecraftVersionManifest>(text, {
    code: MinecraftKitErrorCodes.MANIFEST_INVALID,
    message: `Version JSON is not valid JSON: ${versionJsonPath}`,
    context: { filePath: versionJsonPath },
  });
  return mergeManifest(parentManifest, child);
};
