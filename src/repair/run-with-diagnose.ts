import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import type { MetadataCache } from "../types/cache";
import type { HttpClient } from "../types/http";
import type { RepairMode, VerifyAndRepairInput, VerifyAndRepairResult } from "../types/repair";
import { RepairModes } from "../types/repair";
import type { Spawner } from "../types/spawner";
import type { VerificationKind } from "../types/verify";
import { ASPECTS, type AspectHandlers } from "./aspects";
import { runRepair } from "./runner";

/**
 * Dependencies for the standalone {@link runVerifyAndRepair} helper.
 */
export type RunVerifyAndRepairDeps = {
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly spawner: Spawner;
  /** Host allow-list forwarded to the repair runner's downloads. */
  readonly hostAllowList?: readonly string[];
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
  const handlers = aspectHandlersOrThrow(input.aspect);
  const mode: RepairMode = input.mode ?? RepairModes.FIX;
  const verified = await handlers.verify({
    target: input.target,
    http: deps.http,
    cache: deps.cache,
    ...withOptionalSignal(input.signal),
    ...withOptionalOnEvent(input.onEvent),
  });
  if (mode === RepairModes.REPORT || verified.isValid) {
    return { verified, repair: null };
  }
  const plan = await handlers.plan({
    target: input.target,
    from: verified,
    http: deps.http,
    cache: deps.cache,
    ...withOptionalSignal(input.signal),
  });
  if (plan.totalActions === 0) {
    return { verified, repair: null };
  }
  const repair = await runRepair({
    plan,
    http: deps.http,
    cache: deps.cache,
    spawner: deps.spawner,
    ...(deps.hostAllowList !== undefined ? { hostAllowList: deps.hostAllowList } : {}),
    ...withOptionalSignal(input.signal),
    ...withOptionalOnEvent(input.onEvent),
  });
  return { verified, repair };
};

const aspectHandlersOrThrow = (aspect: VerificationKind): AspectHandlers => {
  if (!Object.hasOwn(ASPECTS, aspect)) {
    throw unsupportedAspect(aspect);
  }
  return ASPECTS[aspect];
};

const unsupportedAspect = (aspect: string): MinecraftKitError => {
  return new MinecraftKitError(
    MinecraftKitErrorCodes.INVALID_INPUT,
    `repair.runVerifyAndRepair: unknown aspect "${aspect}"`,
    { context: { aspect } },
  );
};
