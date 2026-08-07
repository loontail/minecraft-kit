/**
 * Builder for `kit.repair`. Per-aspect repair planners share the same args shape; the
 * runner is the install runner, fed a filtered plan.
 *
 * @internal
 * @packageDocumentation
 */

import {
  withOptionalHostAllowList,
  withOptionalOnEvent,
  withOptionalPauseController,
  withOptionalSignal,
} from "../core/optional";
import type { PauseController } from "../core/pause-controller";
import { type RepairAllReport, repairAll } from "../repair/all";
import { planFabricRepair } from "../repair/fabric";
import { planForgeRepair } from "../repair/forge";
import { planRepairFromError } from "../repair/from-error";
import { planMinecraftRepair } from "../repair/minecraft";
import { runRepair } from "../repair/runner";
import { planRuntimeRepair } from "../repair/runtime";
import { verifyAndRepair } from "../repair/verify-and-repair";
import type { MetadataCache } from "../types/cache";
import type { HttpClient } from "../types/http";
import type {
  RepairAllOptions,
  RepairFromErrorInput,
  RepairPlan,
  RepairPlanOptions,
  RepairReport,
  VerifyAndRepairInput,
  VerifyAndRepairResult,
} from "../types/repair";
import type { Spawner } from "../types/spawner";
import type { Target } from "../types/target";
import type { InstallRunOptions } from "./install-aspect";

/**
 * Options accepted by `repair.<aspect>.run`. Repair executes the install runner over a
 * filtered plan, so this is {@link InstallRunOptions} — same `signal` / `onEvent` /
 * `pauseController` / `actionCategories` semantics, documented there.
 *
 * @example
 * ```ts
 * import { PauseController, type RepairRunOptions } from "@loontail/minecraft-kit";
 *
 * const pauseController = new PauseController();
 * const options: RepairRunOptions = { pauseController, onEvent: (e) => console.log(e.type) };
 * const report = await kit.repair.minecraft.run(plan, options);
 * ```
 */
export type RepairRunOptions = InstallRunOptions;

/**
 * Options accepted by `kit.repair.all`. Adds `pauseController` to {@link RepairAllOptions}.
 *
 * `actionCategories` is deliberately absent: `repair.all` already partitions the work per
 * aspect, and a second category filter on top of that would be ambiguous about which of the
 * two selections wins. Filter per aspect via `repair.<aspect>.run` instead.
 *
 * @example
 * ```ts
 * import { PauseController, type RepairAllRunOptions } from "@loontail/minecraft-kit";
 *
 * const options: RepairAllRunOptions = { pauseController: new PauseController() };
 * const report = await kit.repair.all(target, options);
 * ```
 */
export type RepairAllRunOptions = RepairAllOptions & {
  readonly pauseController?: PauseController;
};

/**
 * Shared shape of every aspect-specific repair surface (`repair.minecraft`, `.fabric`, …).
 *
 * Lives here rather than in `src/types/repair.ts` because its `run` signature references
 * {@link RepairRunOptions}, which needs `PauseController` from `src/core/`.
 *
 * @example
 * ```ts
 * import type { RepairAspectSurface } from "@loontail/minecraft-kit";
 *
 * const runAll = async (aspect: RepairAspectSurface) => {
 *   const verification = await kit.verify.minecraft.run(target);
 *   const plan = await aspect.plan(target, { from: verification });
 *   return aspect.run(plan);
 * };
 * await runAll(kit.repair.minecraft);
 * ```
 */
export type RepairAspectSurface = {
  plan(target: Target, options: RepairPlanOptions): Promise<RepairPlan>;
  run(plan: RepairPlan, options?: RepairRunOptions): Promise<RepairReport>;
};

/**
 * Shape of `kit.repair`. Four aspect-specific surfaces plus the `all` convenience that
 * verifies every applicable slice and repairs each broken one, and `fromError` which
 * resumes a failed install by deriving a focused plan from a typed `MinecraftKitError`.
 */
export type RepairSurface = {
  readonly minecraft: RepairAspectSurface;
  readonly fabric: RepairAspectSurface;
  readonly forge: RepairAspectSurface;
  readonly runtime: RepairAspectSurface;
  all(target: Target, options?: RepairAllRunOptions): Promise<RepairAllReport>;
  fromError(input: RepairFromErrorInput): Promise<RepairPlan>;
  verifyAndRepair(input: VerifyAndRepairInput): Promise<VerifyAndRepairResult>;
};

/**
 * Inputs the repair builder needs from the `MinecraftKit` constructor.
 *
 * @internal
 */
export type RepairAspectDeps = {
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly spawner: Spawner;
  /** Host allow-list forwarded to the repair runner's downloads. */
  readonly hostAllowList?: readonly string[];
};

/**
 * Assemble `kit.repair`.
 *
 * @internal
 */
export const buildRepairAspect = (deps: RepairAspectDeps): RepairSurface => {
  const { http, cache, spawner, hostAllowList } = deps;
  const withHostAllowList = withOptionalHostAllowList(hostAllowList);
  const repairArgs = (target: Target, opts: RepairPlanOptions) => ({
    target,
    from: opts.from,
    http,
    cache,
    ...withHostAllowList,
    ...withOptionalSignal(opts.signal),
    ...(opts.shouldRepairIssue === undefined ? {} : { shouldRepairIssue: opts.shouldRepairIssue }),
  });
  const runRepairPlan: RepairAspectSurface["run"] = (plan, opts) =>
    runRepair({
      plan,
      http,
      cache,
      spawner,
      ...withHostAllowList,
      ...withOptionalSignal(opts?.signal),
      ...withOptionalOnEvent(opts?.onEvent),
      ...withOptionalPauseController(opts?.pauseController),
      ...(opts?.actionCategories !== undefined ? { actionCategories: opts.actionCategories } : {}),
    });
  return {
    minecraft: {
      plan: (target, opts) => planMinecraftRepair(repairArgs(target, opts)),
      run: runRepairPlan,
    },
    fabric: {
      plan: (target, opts) => planFabricRepair(repairArgs(target, opts)),
      run: runRepairPlan,
    },
    forge: {
      plan: (target, opts) => planForgeRepair(repairArgs(target, opts)),
      run: runRepairPlan,
    },
    runtime: {
      plan: (target, opts) => planRuntimeRepair(repairArgs(target, opts)),
      run: runRepairPlan,
    },
    all: (target, opts) =>
      repairAll({
        target,
        http,
        cache,
        spawner,
        ...withHostAllowList,
        ...withOptionalSignal(opts?.signal),
        ...withOptionalOnEvent(opts?.onEvent),
        ...withOptionalPauseController(opts?.pauseController),
        ...(opts?.shouldRepairIssue === undefined
          ? {}
          : { shouldRepairIssue: opts.shouldRepairIssue }),
      }),
    fromError: (input) =>
      planRepairFromError({
        error: input.error,
        target: input.target,
        http,
        cache,
        ...withHostAllowList,
        ...withOptionalSignal(input.signal),
      }),
    verifyAndRepair: (input) =>
      verifyAndRepair({ http, cache, spawner, ...withHostAllowList }, input),
  };
};
