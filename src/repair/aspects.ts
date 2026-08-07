import type { AspectRepairInput, RepairPlan } from "../types/repair";
import {
  type VerificationKind,
  VerificationKinds,
  type VerificationResult,
  type VerifyAspectInput,
} from "../types/verify";
import { VERIFIERS } from "../verify/aspects";
import { planFabricRepair } from "./fabric";
import { planForgeRepair } from "./forge";
import { planMinecraftRepair } from "./minecraft";
import { planRuntimeRepair } from "./runtime";

/**
 * The verify + repair-plan pair for one installation aspect.
 *
 * @internal
 */
export type AspectHandlers = {
  readonly verify: (input: VerifyAspectInput) => Promise<VerificationResult>;
  readonly plan: (input: AspectRepairInput) => Promise<RepairPlan>;
};

/**
 * Single source of truth mapping each {@link VerificationKind} to its verifier and repair
 * planner. Consumed by `repairAll` and `verifyAndRepair` so the aspect↔verify↔plan wiring
 * lives in exactly one place and cannot drift across dispatch sites. The verify half is
 * composed over `verify/aspects`'s {@link VERIFIERS}; `verifyTargetReadiness` uses that map
 * directly so `src/verify/` never imports `src/repair/`.
 *
 * @internal
 */
export const ASPECTS: Record<VerificationKind, AspectHandlers> = {
  [VerificationKinds.MINECRAFT]: {
    verify: VERIFIERS[VerificationKinds.MINECRAFT],
    plan: planMinecraftRepair,
  },
  [VerificationKinds.RUNTIME]: {
    verify: VERIFIERS[VerificationKinds.RUNTIME],
    plan: planRuntimeRepair,
  },
  [VerificationKinds.FABRIC]: {
    verify: VERIFIERS[VerificationKinds.FABRIC],
    plan: planFabricRepair,
  },
  [VerificationKinds.FORGE]: {
    verify: VERIFIERS[VerificationKinds.FORGE],
    plan: planForgeRepair,
  },
};
