import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { silentLogger } from "../core/logger";
import { targetPaths } from "../core/paths";
import type { LaunchComposition, LaunchOptions } from "../types/launch";
import type { Logger } from "../types/logger";
import type { Target } from "../types/target";
import { composeArgs } from "./args-composition";
import { buildClasspath } from "./classpath";
import { buildPlaceholderValues } from "./placeholder-values";
import { pickClientJarVersionId, resolveLaunchVersion } from "./version-resolution";

/** @internal */
export type ComposeLaunchInput = {
  readonly target: Target;
  readonly options: LaunchOptions;
  /** Surfaces non-fatal compose-time warnings; defaults to silent. */
  readonly logger?: Logger;
};

/**
 * Build a fully resolved {@link LaunchComposition} ready to hand to {@link runLaunch}.
 *
 * @internal
 */
export const composeLaunch = async (input: ComposeLaunchInput): Promise<LaunchComposition> => {
  const { target, options } = input;
  if (!options.auth.username || options.auth.username.length === 0) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `Auth username must be non-empty (target ${target.id})`,
      { context: { targetId: target.id } },
    );
  }

  const resolved = await resolveLaunchVersion(target);
  const javaPath = targetPaths.runtimeJavaExecutable(
    target.directory,
    target.runtime.component,
    target.runtime.system.os,
    target.runtime.installRoot,
  );

  const clientJarVersionId = await pickClientJarVersionId(target.directory, resolved.chain);
  const classpath = buildClasspath({
    directory: target.directory,
    versionId: clientJarVersionId,
    merged: resolved.merged,
    system: target.runtime.system,
  });

  const features = buildFeatures(options);
  // Forge 1.17+ JVM args include `-DignoreList=…,${version_name}.jar` so the
  // bootstraplauncher knows which on-classpath jar represents vanilla MC and
  // must not be promoted to a JPMS auto-module (otherwise it conflicts with
  // the patched `minecraft` module assembled from client-srg.jar +
  // client-extra.jar → boot fails with `ResolutionException: Modules minecraft
  // and _1._18._2 export package com.mojang.blaze3d.systems`). Match Voxelum's
  // launcher-core: substitute `${version_name}` to the vanilla MC version when
  // it appears in JVM args, and to the top-level (loader) version id when it
  // appears in game args. The launcher framework treats `version_name` the
  // same in both contexts on vanilla/Fabric (the ids coincide), so the split
  // only matters for Forge.
  const jvmPlaceholderValues = buildPlaceholderValues({
    target,
    versionId: target.minecraft.version,
    auth: options.auth,
    classpath,
    options,
  });
  const gamePlaceholderValues = buildPlaceholderValues({
    target,
    versionId: resolved.versionId,
    auth: options.auth,
    classpath,
    options,
  });
  const composed = composeArgs({
    target,
    merged: resolved.merged,
    options,
    jvmPlaceholderValues,
    gamePlaceholderValues,
    features,
    logger: input.logger ?? silentLogger,
  });

  return {
    targetId: target.id,
    directory: target.directory,
    javaPath,
    mainClass: resolved.merged.mainClass,
    jvmArgs: composed.jvmArgs,
    gameArgs: composed.gameArgs,
    classpath,
    nativesDirectory: targetPaths.nativesDir(target.directory, target.minecraft.version),
    auth: options.auth,
    workingDirectory: target.directory,
  };
};

const buildFeatures = (options: LaunchOptions): Readonly<Record<string, boolean>> => {
  const features: Record<string, boolean> = { ...(options.features ?? {}) };
  if (options.resolution !== undefined) {
    features.has_custom_resolution = true;
  }
  return features;
};
