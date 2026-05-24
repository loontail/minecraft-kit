/**
 * Builder for `kit.repair`. Per-aspect repair planners share the same args shape; the
 * runner is the install runner, fed a filtered plan.
 *
 * @internal
 * @packageDocumentation
 */

import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import { type RepairAllReport, repairAll } from "../repair/all";
import { planFabricRepair } from "../repair/fabric";
import { planForgeRepair } from "../repair/forge";
import { planRepairFromError } from "../repair/from-error";
import { planMinecraftRepair } from "../repair/minecraft";
import { runRepair } from "../repair/runner";
import { planRuntimeRepair } from "../repair/runtime";
import type { MetadataCache } from "../types/cache";
import type { OperationOptions } from "../types/events";
import type { HttpClient } from "../types/http";
import type {
  RepairAspect,
  RepairFromErrorInput,
  RepairPlan,
  RepairPlanOptions,
} from "../types/repair";
import type { Spawner } from "../types/spawner";
import type { Target } from "../types/target";

/**
 * Shape of `kit.repair`. Four aspect-specific surfaces plus the `all` convenience that
 * verifies every applicable slice and repairs each broken one, and `fromError` which
 * resumes a failed install by deriving a focused plan from a typed `MinecraftKitError`.
 *
 * @internal
 */
export type RepairSurface = {
  readonly minecraft: RepairAspect;
  readonly fabric: RepairAspect;
  readonly forge: RepairAspect;
  readonly runtime: RepairAspect;
  all(target: Target, options?: OperationOptions): Promise<RepairAllReport>;
  fromError(input: RepairFromErrorInput): Promise<RepairPlan>;
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
};

/**
 * Assemble `kit.repair`.
 *
 * @internal
 */
export const buildRepairAspect = (deps: RepairAspectDeps): RepairSurface => {
  const { http, cache, spawner } = deps;
  const repairArgs = (target: Target, opts: RepairPlanOptions) => ({
    target,
    from: opts.from,
    http,
    cache,
    ...withOptionalSignal(opts.signal),
  });
  const runRepairPlan: RepairAspect["run"] = (plan, opts) =>
    runRepair({
      plan,
      http,
      cache,
      spawner,
      ...withOptionalSignal(opts?.signal),
      ...withOptionalOnEvent(opts?.onEvent),
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
        ...withOptionalSignal(opts?.signal),
        ...withOptionalOnEvent(opts?.onEvent),
      }),
    fromError: (input) =>
      planRepairFromError({
        error: input.error,
        target: input.target,
        http,
        cache,
        ...withOptionalSignal(input.signal),
      }),
  };
};
