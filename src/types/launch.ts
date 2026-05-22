import type { LaunchAuth } from "./auth";
import type { ProgressEvent } from "./events";

/**
 * Optional memory configuration.
 *
 * @example
 * ```ts
 * import type { LaunchMemoryOptions } from "@loontail/minecraft-kit";
 *
 * const memory: LaunchMemoryOptions = { minMb: 2048, maxMb: 4096 };
 * await kit.launch.compose(target, { auth, memory });
 * ```
 */
export type LaunchMemoryOptions = {
  readonly minMb?: number;
  readonly maxMb?: number;
};

/**
 * Optional resolution / window configuration.
 *
 * @example
 * ```ts
 * import type { LaunchResolutionOptions } from "@loontail/minecraft-kit";
 *
 * const resolution: LaunchResolutionOptions = { width: 1280, height: 720 };
 * await kit.launch.compose(target, { auth, resolution });
 * ```
 */
export type LaunchResolutionOptions = {
  readonly width: number;
  readonly height: number;
};

/**
 * Inputs for `kit.launch.compose` (and the lower-level `composeLaunch` helper).
 *
 * @example
 * ```ts
 * import { AuthModes, type LaunchOptions } from "@loontail/minecraft-kit";
 *
 * const options: LaunchOptions = {
 *   auth: { mode: AuthModes.OFFLINE, username: "Steve" },
 *   memory: { maxMb: 4096 },
 *   launcherName: "MyLauncher",
 *   launcherVersion: "1.0.0",
 * };
 * const composition = await kit.launch.compose(target, options);
 * ```
 */
export type LaunchOptions = {
  readonly auth: LaunchAuth;
  readonly memory?: LaunchMemoryOptions;
  readonly resolution?: LaunchResolutionOptions;
  readonly fullscreen?: boolean;
  /** Brand string injected as `${launcher_name}`. */
  readonly launcherName?: string;
  /** Version string injected as `${launcher_version}`. */
  readonly launcherVersion?: string;
  /** Extra JVM args appended after composed JVM args. */
  readonly extraJvmArgs?: readonly string[];
  /** Extra game args appended after composed game args. */
  readonly extraGameArgs?: readonly string[];
  /** Set of feature flags evaluated by argument rules (e.g. `is_demo_user`). */
  readonly features?: Readonly<Record<string, boolean>>;
};

/**
 * Fully composed launch command, ready to be passed to `kit.launch.run`.
 *
 * @example
 * ```ts
 * import type { LaunchComposition } from "@loontail/minecraft-kit";
 *
 * const composition: LaunchComposition = await kit.launch.compose(target, { auth });
 * console.log(`${composition.javaPath} ${composition.mainClass} (${composition.classpath.length} jars)`);
 * const session = kit.launch.run(composition);
 * ```
 */
export type LaunchComposition = {
  readonly targetId: string;
  readonly directory: string;
  readonly javaPath: string;
  readonly mainClass: string;
  readonly jvmArgs: readonly string[];
  readonly gameArgs: readonly string[];
  readonly classpath: readonly string[];
  readonly nativesDirectory: string;
  readonly auth: LaunchAuth;
  /** Spawn working directory (almost always equal to {@link directory}). */
  readonly workingDirectory: string;
  /** Environment variables to set on the spawned process. */
  readonly env?: Readonly<Record<string, string>>;
};

/**
 * Live handle for a running game process.
 *
 * @example
 * ```ts
 * import type { LaunchSession } from "@loontail/minecraft-kit";
 *
 * const session: LaunchSession = kit.launch.run(composition);
 * console.log("game pid:", session.pid);
 * process.once("SIGINT", () => session.abort("user-interrupt"));
 * const exit = await session.exited;
 * ```
 */
export type LaunchSession = {
  /** Operating-system process id. */
  readonly pid: number;
  /** Resolves with the exit code/signal when the process terminates. */
  readonly exited: Promise<LaunchExit>;
  /** Best-effort cancel — sends SIGTERM, then SIGKILL after the grace period. */
  abort(reason?: string): void;
};

/**
 * Outcome of a finished launch.
 *
 * @example
 * ```ts
 * import type { LaunchExit } from "@loontail/minecraft-kit";
 *
 * const exit: LaunchExit = await session.exited;
 * if (exit.aborted) console.log("aborted by caller");
 * else if (exit.code !== 0) console.error(`crashed with code ${exit.code}, signal ${exit.signal}`);
 * ```
 */
export type LaunchExit = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly aborted: boolean;
};

/**
 * Options for `kit.launch.run` (and the lower-level `runLaunch` helper).
 *
 * @example
 * ```ts
 * import { EventTypes, type LaunchRunOptions } from "@loontail/minecraft-kit";
 *
 * const options: LaunchRunOptions = {
 *   onEvent: (e) => {
 *     if (e.type === EventTypes.LAUNCH_STDOUT) console.log("[game]", e.line);
 *   },
 *   killGracePeriodMs: 5000,
 * };
 * const session = kit.launch.run(composition, options);
 * ```
 */
export type LaunchRunOptions = {
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: ProgressEvent) => void;
  /** Milliseconds to wait between SIGTERM and SIGKILL when aborting. */
  readonly killGracePeriodMs?: number;
};
