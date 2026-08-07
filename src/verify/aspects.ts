import { Loaders } from "../types/loader";
import type { Target } from "../types/target";
import {
  type VerificationKind,
  VerificationKinds,
  type VerificationResult,
  type VerifyAspectInput,
} from "../types/verify";
import { verifyFabric } from "./fabric";
import { verifyForge } from "./forge";
import { verifyMinecraft } from "./minecraft";
import { verifyRuntime } from "./runtime";

/**
 * Single source of truth mapping each {@link VerificationKind} to its verifier. Consumed by
 * `verifyTargetReadiness` directly and by `repair/aspects`, which composes it with the repair
 * planners — so the aspect↔verify wiring lives in exactly one place and cannot drift, without
 * dragging the repair layer into `src/verify/`'s import graph.
 *
 * @internal
 */
export const VERIFIERS: Record<
  VerificationKind,
  (input: VerifyAspectInput) => Promise<VerificationResult>
> = {
  [VerificationKinds.MINECRAFT]: verifyMinecraft,
  [VerificationKinds.RUNTIME]: verifyRuntime,
  [VerificationKinds.FABRIC]: verifyFabric,
  [VerificationKinds.FORGE]: verifyForge,
};

/**
 * The launch-critical aspects that apply to a target: always Minecraft + runtime, plus the
 * loader aspect matching the target's loader. The single definition of "which aspects does
 * this target have", shared by `repairAll` and `verifyTargetReadiness`.
 *
 * @internal
 */
export const aspectsForTarget = (target: Target): readonly VerificationKind[] => {
  const aspects: VerificationKind[] = [VerificationKinds.MINECRAFT, VerificationKinds.RUNTIME];
  if (target.loader.type === Loaders.FABRIC) {
    aspects.push(VerificationKinds.FABRIC);
  } else if (target.loader.type === Loaders.FORGE) {
    aspects.push(VerificationKinds.FORGE);
  }
  return aspects;
};
