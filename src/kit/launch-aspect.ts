/**
 * Builder for `kit.launch`. `composeLaunch` resolves the version chain + classpath +
 * placeholders + arg pipeline; `runLaunch` spawns the child via the injected spawner.
 *
 * @internal
 * @packageDocumentation
 */

import { composeLaunch } from "../launch/compose";
import { launchPreflight } from "../launch/preflight";
import { runLaunch } from "../launch/runner";
import type {
  LaunchComposition,
  LaunchOptions,
  LaunchPreflightResult,
  LaunchRunOptions,
  LaunchSession,
} from "../types/launch";
import type { Logger } from "../types/logger";
import type { Spawner } from "../types/spawner";
import type { Target } from "../types/target";

/**
 * Shape of `kit.launch`.
 */
export type LaunchAspect = {
  compose(target: Target, options: LaunchOptions): Promise<LaunchComposition>;
  /**
   * Spawn the game. The only `run` in the library that is **not** async: it returns the live
   * {@link LaunchSession} synchronously so the caller holds `pid` and `abort()` immediately.
   * `await`ing it yields the session, not the exit — wait on `session.exited` for that.
   *
   * Throws `LAUNCH_JAVA_NOT_FOUND` before spawning when `composition.javaPath` is an absolute
   * path that is not a file.
   */
  run(composition: LaunchComposition, options?: LaunchRunOptions): LaunchSession;
  /**
   * Cheap, network-free readiness gate: reports whether every launch-critical file (java
   * executable, version JSON, client jar, classpath entries) is present on disk. The
   * network-free subset of `verify.targetReady.run`, reporting the same shape.
   */
  preflight(target: Target): Promise<LaunchPreflightResult>;
};

/**
 * Inputs the launch builder needs from the `MinecraftKit` constructor.
 *
 * @internal
 */
export type LaunchAspectDeps = {
  readonly spawner: Spawner;
  readonly logger: Logger;
};

/**
 * Assemble `kit.launch`.
 *
 * @internal
 */
export const buildLaunchAspect = (deps: LaunchAspectDeps): LaunchAspect => {
  const { spawner, logger } = deps;
  return {
    compose: (target, opts) => composeLaunch({ target, options: opts, logger }),
    run: (composition, opts) =>
      runLaunch({ composition, ...(opts !== undefined ? { options: opts } : {}), spawner }),
    preflight: (target) => launchPreflight(target),
  };
};
