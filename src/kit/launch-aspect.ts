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
  run(composition: LaunchComposition, options?: LaunchRunOptions): LaunchSession;
  /**
   * Cheap, network-free readiness gate: reports whether every launch-critical file (java
   * executable, version JSON, client jar, classpath entries) is present on disk.
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
