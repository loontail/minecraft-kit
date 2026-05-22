import type { MetadataCache } from "./cache";
import type { HttpClient } from "./http";
import type { InstallAction } from "./install";
import type { Target } from "./target";
import type { VerificationResult } from "./verify";

/**
 * Coarse-grained repair phases used for `repair:phase-changed` events.
 *
 * @example
 * ```ts
 * import { RepairPhases, type RepairPhase } from "@loontail/minecraft-kit";
 *
 * const label = (phase: RepairPhase): string =>
 *   phase === RepairPhases.REPAIRING_ASSETS ? "Repairing assets…" : phase;
 * ```
 */
export const RepairPhases = {
  PLANNING: "planning",
  REPAIRING_CLIENT_JAR: "repairing-client-jar",
  REPAIRING_LIBRARIES: "repairing-libraries",
  REPAIRING_ASSETS: "repairing-assets",
  REPAIRING_NATIVES: "repairing-natives",
  REPAIRING_RUNTIME: "repairing-runtime",
  REPAIRING_LOADER: "repairing-loader",
  COMPLETED: "completed",
} as const;

/**
 * Repair phase literal.
 *
 * @example
 * ```ts
 * import { RepairPhases, type RepairPhase } from "@loontail/minecraft-kit";
 *
 * const isDone = (phase: RepairPhase) => phase === RepairPhases.COMPLETED;
 * ```
 */
export type RepairPhase = (typeof RepairPhases)[keyof typeof RepairPhases];

/**
 * A repair plan is, structurally, an install plan limited to actions needed to fix the
 * issues reported by a previous {@link VerificationResult}. The runner is the same.
 *
 * @example
 * ```ts
 * import type { RepairPlan } from "@loontail/minecraft-kit";
 *
 * const verification = await kit.verify.minecraft.run(target);
 * const plan: RepairPlan = await kit.repair.minecraft.plan(target, { from: verification });
 * console.log(`will redo ${plan.totalActions} actions (${plan.totalBytes} bytes)`);
 * ```
 */
export type RepairPlan = {
  readonly targetId: string;
  readonly directory: string;
  readonly target: Target;
  readonly actions: readonly InstallAction[];
  readonly totalBytes: number;
  readonly totalActions: number;
};

/**
 * Repair report — same shape as install report.
 *
 * @example
 * ```ts
 * import type { RepairReport } from "@loontail/minecraft-kit";
 *
 * const report: RepairReport = await kit.repair.minecraft.run(plan);
 * console.log(`repaired ${report.actionsCompleted} actions in ${report.durationMs}ms`);
 * ```
 */
export type RepairReport = {
  readonly targetId: string;
  readonly bytesDownloaded: number;
  readonly actionsCompleted: number;
  readonly durationMs: number;
};

/**
 * Inputs accepted by every aspect-specific `planXxxRepair` (`planMinecraftRepair`,
 * `planFabricRepair`, `planForgeRepair`, `planRuntimeRepair`). The per-aspect input types
 * are aliases over this shape.
 *
 * @example
 * ```ts
 * import type { AspectRepairInput } from "@loontail/minecraft-kit";
 *
 * // The kit wraps this for you — callers usually only see `target` and `from`:
 * const verification = await kit.verify.fabric.run(target);
 * const plan = await kit.repair.fabric.plan(target, { from: verification });
 * ```
 */
export type AspectRepairInput = {
  readonly target: Target;
  readonly from: VerificationResult | readonly VerificationResult[];
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly signal?: AbortSignal;
};
