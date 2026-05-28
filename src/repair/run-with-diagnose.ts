import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import type { MetadataCache } from "../types/cache";
import type { HttpClient } from "../types/http";
import type {
  AspectRepairInput,
  RepairMode,
  RepairPlan,
  VerifyAndRepairInput,
  VerifyAndRepairResult,
} from "../types/repair";
import { RepairModes } from "../types/repair";
import type { Spawner } from "../types/spawner";
import {
  VerificationKinds,
  type VerificationResult,
  type VerifyOperationOptions,
} from "../types/verify";
import { verifyFabric } from "../verify/fabric";
import { verifyForge } from "../verify/forge";
import { verifyMinecraft } from "../verify/minecraft";
import { verifyRuntime } from "../verify/runtime";
import { planFabricRepair } from "./fabric";
import { planForgeRepair } from "./forge";
import { planMinecraftRepair } from "./minecraft";
import { runRepair } from "./runner";
import { planRuntimeRepair } from "./runtime";

/**
 * Dependencies for the standalone {@link runVerifyAndRepair} helper.
 */
export type RunVerifyAndRepairDeps = {
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly spawner: Spawner;
};

/**
 * Verify a single aspect and, in `'fix'` mode (default), repair every broken file before
 * returning. In `'report'` mode the function never touches disk — it returns the
 * verification only and leaves `repair` as `null`.
 *
 * The helper is a thin orchestrator on top of the existing per-aspect verifiers and repair
 * planners. It exists so consumers do not have to wire three calls (`verify` → `plan` →
 * `run`) by hand for the common "find and fix this aspect" case.
 *
 * Prefer `kit.repair.runVerifyAndRepair({ aspect, target })` over importing this directly.
 *
 * @example
 * ```ts
 * import { MinecraftKit, RepairModes } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const { verified, repair } = await kit.repair.runVerifyAndRepair({
 *   aspect: "minecraft",
 *   target,
 * });
 * if (repair !== null) console.log(`repaired ${repair.actionsCompleted} files`);
 *
 * const diagnosis = await kit.repair.runVerifyAndRepair({
 *   aspect: "runtime",
 *   target,
 *   mode: RepairModes.REPORT,
 * });
 * if (!diagnosis.verified.isValid) console.warn("runtime broken, ask user to repair");
 * ```
 */
export const runVerifyAndRepair = async (
  deps: RunVerifyAndRepairDeps,
  input: VerifyAndRepairInput,
): Promise<VerifyAndRepairResult> => {
  const mode: RepairMode = input.mode ?? RepairModes.FIX;
  const verified = await verifyForAspect(deps, input);
  if (mode === RepairModes.REPORT || verified.isValid) {
    return { verified, repair: null };
  }
  const plan = await planForAspect(deps, input, verified);
  if (plan.totalActions === 0) {
    return { verified, repair: null };
  }
  const repair = await runRepair({
    plan,
    http: deps.http,
    cache: deps.cache,
    spawner: deps.spawner,
    ...withOptionalSignal(input.signal),
    ...withOptionalOnEvent(input.onEvent),
  });
  return { verified, repair };
};

const verifyForAspect = (
  deps: RunVerifyAndRepairDeps,
  input: VerifyAndRepairInput,
): Promise<VerificationResult> => {
  const verifyOptions: VerifyOperationOptions = {
    ...withOptionalSignal(input.signal),
    ...withOptionalOnEvent(input.onEvent),
  };
  const args = {
    target: input.target,
    http: deps.http,
    cache: deps.cache,
    ...verifyOptions,
  };
  switch (input.aspect) {
    case VerificationKinds.MINECRAFT:
      return verifyMinecraft(args);
    case VerificationKinds.RUNTIME:
      return verifyRuntime(args);
    case VerificationKinds.FABRIC:
      return verifyFabric(args);
    case VerificationKinds.FORGE:
      return verifyForge(args);
    default:
      throw unsupportedAspect(input.aspect);
  }
};

const planForAspect = (
  deps: RunVerifyAndRepairDeps,
  input: VerifyAndRepairInput,
  from: VerificationResult,
): Promise<RepairPlan> => {
  const args: AspectRepairInput = {
    target: input.target,
    from,
    http: deps.http,
    cache: deps.cache,
    ...withOptionalSignal(input.signal),
  };
  switch (input.aspect) {
    case VerificationKinds.MINECRAFT:
      return planMinecraftRepair(args);
    case VerificationKinds.RUNTIME:
      return planRuntimeRepair(args);
    case VerificationKinds.FABRIC:
      return planFabricRepair(args);
    case VerificationKinds.FORGE:
      return planForgeRepair(args);
    default:
      throw unsupportedAspect(input.aspect);
  }
};

const unsupportedAspect = (aspect: string): MinecraftKitError => {
  return new MinecraftKitError(
    MinecraftKitErrorCodes.INVALID_INPUT,
    `repair.runVerifyAndRepair: unknown aspect "${aspect}"`,
    { context: { aspect } },
  );
};
