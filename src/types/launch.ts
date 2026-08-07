import type { LaunchAuth } from "./auth";
import type { ProgressEvent } from "./events";
import type { TargetReadinessIssue, TargetReadinessResult } from "./verify";

/**
 * Optional memory configuration.
 */
export type LaunchMemoryOptions = {
  readonly minMb?: number;
  readonly maxMb?: number;
};

/**
 * Optional resolution / window configuration.
 */
export type LaunchResolutionOptions = {
  readonly width: number;
  readonly height: number;
};

/**
 * Inputs for `kit.launch.compose` (and the lower-level `composeLaunch` helper).
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
 * Result of a network-free `kit.launch.preflight(target)` check.
 *
 * `preflight` is the network-free subset of `kit.verify.targetReady.run`: it checks existence
 * only, never fetches a manifest and never hashes a file. It reports the same field names and
 * the same issue shape as {@link TargetReadinessResult}, so one renderer covers both and a
 * caller can upgrade from the cheap gate to the thorough one without rewriting its branches.
 */
export type LaunchPreflightResult = {
  readonly targetId: string;
  /** True when every launch-critical file is present on disk. */
  readonly isReady: boolean;
  /**
   * The launch-critical files that are absent, every one with
   * `status: VerifyFileStatuses.MISSING` — preflight cannot report corruption because it does
   * not hash. Empty when `isReady`.
   */
  readonly issues: readonly TargetReadinessIssue[];
  readonly durationMs: number;
};

/**
 * Live handle for a running game process.
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
 */
export type LaunchExit = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly aborted: boolean;
};

/**
 * Options for `kit.launch.run` (and the lower-level `runLaunch` helper).
 */
export type LaunchRunOptions = {
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: ProgressEvent) => void;
  /** Milliseconds to wait between SIGTERM and SIGKILL when aborting. */
  readonly killGracePeriodMs?: number;
};
