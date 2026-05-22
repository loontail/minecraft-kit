import { DEFAULT_MAX_MB, DEFAULT_MIN_MB } from "../constants/defaults";
import { BASE_JVM_ARGS, LEGACY_JVM_ARGS, MACOS_JVM_ARGS } from "../constants/launch";
import { silentLogger } from "../core/logger";
import { targetPaths } from "../core/paths";
import type { LaunchOptions } from "../types/launch";
import type { Logger } from "../types/logger";
import type { MinecraftVersionManifest } from "../types/minecraft";
import type { Target } from "../types/target";
import { pickArguments, splitLegacyArguments } from "./arguments";
import { filterArgsForJava } from "./jvm-compat";
import { substituteArgs } from "./placeholders";

/**
 * Output of {@link composeArgs}.
 *
 * @internal
 */
export type ComposedArgs = {
  readonly jvmArgs: readonly string[];
  readonly gameArgs: readonly string[];
};

/**
 * Build the final JVM and game argument lists for a launch. The order is:
 *
 *   jvmArgs  = memory + base + macos + manifest-jvm + (logging) + caller-extra
 *   gameArgs = manifest-game + caller-extra + (resolution/fullscreen)
 *
 * Caller-extra entries land last so the user can override anything emitted by the manifest
 * (last-wins for JVM `-Xms`/`-Xmx`, additive for game args).
 *
 * @internal
 */
export const composeArgs = (input: {
  readonly target: Target;
  readonly merged: MinecraftVersionManifest;
  readonly options: LaunchOptions;
  readonly placeholderValues: Readonly<Record<string, string>>;
  readonly features: Readonly<Record<string, boolean>>;
  readonly logger?: Logger;
}): ComposedArgs => {
  const minMb = input.options.memory?.minMb ?? DEFAULT_MIN_MB;
  const maxMb = input.options.memory?.maxMb ?? DEFAULT_MAX_MB;
  const memoryArgs = [`-Xms${minMb}M`, `-Xmx${maxMb}M`];
  const ruleContext = { system: input.target.runtime.system, features: input.features };

  let rawJvm: readonly string[];
  let rawGame: readonly string[];
  if (input.merged.arguments) {
    const picked = pickArguments(input.merged.arguments, ruleContext);
    rawJvm = picked.jvm;
    rawGame = picked.game;
  } else if (input.merged.minecraftArguments) {
    rawJvm = LEGACY_JVM_ARGS;
    rawGame = splitLegacyArguments(input.merged.minecraftArguments);
  } else {
    rawJvm = [];
    rawGame = [];
  }

  const macosArgs = input.target.runtime.system.os === "osx" ? MACOS_JVM_ARGS : [];
  const baseJvm = [...memoryArgs, ...BASE_JVM_ARGS, ...macosArgs];
  const substitutedJvm = substituteArgs(rawJvm, input.placeholderValues);
  const substitutedGame = substituteArgs(rawGame, input.placeholderValues);
  // Base + macOS args are static and known-safe; only manifest args get filtered.
  const javaMajor = input.target.runtime.majorVersion;
  const filteredManifestJvm =
    javaMajor !== undefined
      ? filterArgsForJava({
          args: substitutedJvm,
          javaMajor,
          logger: input.logger ?? silentLogger,
        })
      : substitutedJvm;
  const jvmArgs = [...baseJvm, ...filteredManifestJvm];

  if (input.merged.logging?.client?.argument) {
    const logging = input.merged.logging.client;
    const loggingArg = substituteArgs([logging.argument], {
      ...input.placeholderValues,
      path: targetPaths.loggingConfig(input.target.directory, logging.file.id),
    })[0];
    if (loggingArg !== undefined) jvmArgs.push(loggingArg);
  }

  const extraJvm = input.options.extraJvmArgs ?? [];
  const extraGame = input.options.extraGameArgs ?? [];
  const gameArgs = [...substitutedGame, ...extraGame];

  if (input.options.fullscreen === true) gameArgs.push("--fullscreen");
  if (input.options.resolution !== undefined && rawGame.every((a) => !a.includes("--width"))) {
    gameArgs.push(
      "--width",
      input.options.resolution.width.toString(),
      "--height",
      input.options.resolution.height.toString(),
    );
  }

  return { jvmArgs: [...jvmArgs, ...extraJvm], gameArgs };
};
