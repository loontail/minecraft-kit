import { Loaders } from "../types/loader";
import type { AspectRepairInput, RepairPlan } from "../types/repair";
import type { Target } from "../types/target";
import {
  type VerificationKind,
  VerificationKinds,
  type VerificationResult,
  type VerifyAspectInput,
} from "../types/verify";
import { verifyFabric } from "../verify/fabric";
import { verifyForge } from "../verify/forge";
import { verifyMinecraft } from "../verify/minecraft";
import { verifyRuntime } from "../verify/runtime";
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
 * planner. Consumed by `repairAll`, `runVerifyAndRepair`, and `verifyTargetReadiness` so the
 * aspect↔verify↔plan wiring lives in exactly one place and cannot drift across dispatch sites.
 *
 * @internal
 */
export const ASPECTS: Record<VerificationKind, AspectHandlers> = {
  [VerificationKinds.MINECRAFT]: { verify: verifyMinecraft, plan: planMinecraftRepair },
  [VerificationKinds.RUNTIME]: { verify: verifyRuntime, plan: planRuntimeRepair },
  [VerificationKinds.FABRIC]: { verify: verifyFabric, plan: planFabricRepair },
  [VerificationKinds.FORGE]: { verify: verifyForge, plan: planForgeRepair },
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
