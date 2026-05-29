/**
 * Builder for `kit.install`. Owns the `InstallRunOptions` shape because it is the only
 * type that needs `PauseController` (which lives in `src/core/` and so cannot live in
 * `src/types/`).
 *
 * @internal
 * @packageDocumentation
 */

import {
  withOptionalOnEvent,
  withOptionalPauseController,
  withOptionalSignal,
} from "../core/optional";
import type { PauseController } from "../core/pause-controller";
import { planInstall } from "../install/planner";
import { runInstall } from "../install/runner";
import {
  type PlanStandaloneRuntimeInstallInput,
  planRuntimeInstall,
  planStandaloneRuntimeInstall,
} from "../install/runtime-install";
import type { MetadataCache } from "../types/cache";
import type { OperationOptions, ProgressListener } from "../types/events";
import type { HttpClient } from "../types/http";
import type { DownloadAction, InstallPlan, InstallReport } from "../types/install";
import type { Spawner } from "../types/spawner";
import type { Target } from "../types/target";

/**
 * Options accepted by `install.run` (and `install.runtime.run`).
 *
 * @example
 * ```ts
 * import { PauseController, type InstallRunOptions } from "@loontail/minecraft-kit";
 *
 * const pauseController = new PauseController();
 * const controller = new AbortController();
 * const options: InstallRunOptions = {
 *   pauseController,
 *   signal: controller.signal,
 *   onEvent: (e) => console.log(e.type),
 * };
 * await kit.install.run(plan, options);
 * ```
 */
export type InstallRunOptions = OperationOptions & {
  /**
   * Cooperative pause/resume primitive — see {@link PauseController}. The runner checks the
   * pause state at every stage boundary and between download chunks.
   */
  readonly pauseController?: PauseController;
  /**
   * Filter the run to a subset of action categories. Useful for partial reinstalls
   * (e.g. assets-only). When omitted, every action in the plan runs.
   *
   * @example
   * ```ts
   * import { DownloadCategories } from "@loontail/minecraft-kit";
   *
   * await kit.install.run(plan, {
   *   actionCategories: new Set([
   *     DownloadCategories.CLIENT_JAR,
   *     DownloadCategories.LIBRARY,
   *     DownloadCategories.ASSET_INDEX,
   *     DownloadCategories.ASSET,
   *   ]),
   * });
   * ```
   */
  readonly actionCategories?: ReadonlySet<DownloadAction["category"]>;
};

/**
 * Shape of `kit.install`. Consumers usually access this through `kit.install`; the alias is
 * exported so the facade documentation can show the concrete surface.
 */
export type InstallAspect = {
  /**
   * Build the install plan for a target. Side-effect-free for vanilla and Fabric.
   *
   * **Forge is the exception**: planning downloads the Forge installer JAR and extracts its
   * embedded Maven artifacts to `libraries/`, because the per-library and processor actions
   * can only be enumerated after reading the installer's `install_profile.json` from disk.
   * Do not treat `plan(forgeTarget)` as a pure/offline dry-run — it requires network + disk.
   */
  plan(target: Target, options?: OperationOptions): Promise<InstallPlan>;
  run(plan: InstallPlan, options?: InstallRunOptions): Promise<InstallReport>;
  readonly runtime: {
    plan(target: Target, options?: OperationOptions): Promise<InstallPlan>;
    run(plan: InstallPlan, options?: InstallRunOptions): Promise<InstallReport>;
    standalonePlan(
      input: Omit<PlanStandaloneRuntimeInstallInput, "http" | "cache">,
    ): Promise<InstallPlan>;
  };
};

const forwardSignalAndEvent = (
  opts: { signal?: AbortSignal; onEvent?: ProgressListener } | undefined,
) => ({
  ...withOptionalSignal(opts?.signal),
  ...withOptionalOnEvent(opts?.onEvent),
});

const forwardInstallRunOptions = (opts: InstallRunOptions | undefined) => ({
  ...forwardSignalAndEvent(opts),
  ...withOptionalPauseController(opts?.pauseController),
  ...(opts?.actionCategories !== undefined ? { actionCategories: opts.actionCategories } : {}),
});

/**
 * Inputs the install builder needs from the `MinecraftKit` constructor.
 *
 * @internal
 */
export type InstallAspectDeps = {
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly spawner: Spawner;
  /** Host allow-list forwarded to the install runner's downloads. */
  readonly hostAllowList?: readonly string[];
};

/**
 * Assemble `kit.install`.
 *
 * @internal
 */
export const buildInstallAspect = (deps: InstallAspectDeps): InstallAspect => {
  const { http, cache, spawner, hostAllowList } = deps;
  const runInstallPlan = (plan: InstallPlan, opts?: InstallRunOptions) =>
    runInstall({
      plan,
      http,
      cache,
      spawner,
      ...(hostAllowList !== undefined ? { hostAllowList } : {}),
      ...forwardInstallRunOptions(opts),
    });
  return {
    plan: (target, opts) => planInstall({ target, http, cache, ...forwardSignalAndEvent(opts) }),
    run: runInstallPlan,
    runtime: {
      plan: (target, opts) =>
        planRuntimeInstall({ target, http, cache, ...forwardSignalAndEvent(opts) }),
      run: runInstallPlan,
      standalonePlan: (input) => planStandaloneRuntimeInstall({ ...input, http, cache }),
    },
  };
};
