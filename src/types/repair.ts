import type { MetadataCache } from "./cache";
import type { MinecraftKitErrorCode, MinecraftKitErrorContext } from "./errors";
import type { OperationOptions, ProgressListener } from "./events";
import type { HttpClient } from "./http";
import type { InstallAction } from "./install";
import type { Target } from "./target";
import type { VerificationFileResult, VerificationKind, VerificationResult } from "./verify";

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
 * Context passed to caller-owned repair filters.
 *
 * @example
 * ```ts
 * import type { RepairIssueFilterInput } from "@loontail/minecraft-kit";
 *
 * const describeIssue = (input: RepairIssueFilterInput) =>
 *   `${input.verification.kind}:${input.issue.path}`;
 * ```
 */
export type RepairIssueFilterInput = {
  readonly target: Target;
  readonly verification: VerificationResult;
  readonly issue: VerificationFileResult;
};

/**
 * Predicate used by repair planning to decide whether a verification issue belongs to
 * the kit-managed repair plan. Return `false` for files intentionally owned by the caller.
 *
 * @example
 * ```ts
 * import type { RepairIssueFilter } from "@loontail/minecraft-kit";
 *
 * const shouldRepairIssue: RepairIssueFilter = ({ issue }) =>
 *   !bundleOwnedPaths.has(issue.path);
 * ```
 */
export type RepairIssueFilter = (input: RepairIssueFilterInput) => boolean;

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
  readonly shouldRepairIssue?: RepairIssueFilter;
};

/**
 * Options for any `repair.<aspect>.plan` call. Accepts one or many verification results.
 *
 * @example
 * ```ts
 * import type { RepairPlanOptions } from "@loontail/minecraft-kit";
 *
 * const mcResult = await kit.verify.minecraft.run(target);
 * const runtimeResult = await kit.verify.runtime.run(target);
 * const options: RepairPlanOptions = { from: [mcResult, runtimeResult] };
 * const plan = await kit.repair.minecraft.plan(target, options);
 * ```
 */
export type RepairPlanOptions = {
  readonly from: VerificationResult | readonly VerificationResult[];
  readonly signal?: AbortSignal;
  readonly shouldRepairIssue?: RepairIssueFilter;
};

/**
 * Options for `kit.repair.all`. Extends the common long-running operation options with
 * caller-owned issue filtering.
 *
 * @example
 * ```ts
 * const report = await kit.repair.all(target, {
 *   signal,
 *   shouldRepairIssue: ({ issue }) => !bundleOwnedPaths.has(issue.path),
 * });
 * ```
 */
export type RepairAllOptions = OperationOptions & {
  readonly shouldRepairIssue?: RepairIssueFilter;
};

/**
 * Shared shape of every aspect-specific repair surface (`repair.minecraft`, `.fabric`, …).
 *
 * @example
 * ```ts
 * import type { RepairAspect } from "@loontail/minecraft-kit";
 *
 * const runAll = async (aspect: RepairAspect) => {
 *   const verification = await kit.verify.minecraft.run(target);
 *   const plan = await aspect.plan(target, { from: verification });
 *   return aspect.run(plan);
 * };
 * await runAll(kit.repair.minecraft);
 * ```
 */
export type RepairAspect = {
  plan(target: Target, options: RepairPlanOptions): Promise<RepairPlan>;
  run(plan: RepairPlan, options?: OperationOptions): Promise<RepairReport>;
};

/**
 * Structural shape of the `MinecraftKitError` passed to {@link RepairFromErrorInput}.
 * Defined here so `src/types/` does not need to import the error class from `src/core/`.
 * Any thrown `MinecraftKitError` satisfies this shape.
 */
export type RepairableErrorLike = {
  readonly code: MinecraftKitErrorCode;
  readonly context: Readonly<MinecraftKitErrorContext>;
};

/**
 * Modes accepted by `kit.repair.runVerifyAndRepair`.
 *
 * `'fix'` (default) — when verification surfaces issues, plan and execute the repair, then
 * return both the verification and the resulting repair report.
 *
 * `'report'` — only run verification; never touch disk. The returned `repair` is always
 * `null`. Useful for UIs that show the diagnosis first and ask the user before fixing.
 *
 * @example
 * ```ts
 * import { RepairModes } from "@loontail/minecraft-kit";
 *
 * const { verified, repair } = await kit.repair.runVerifyAndRepair({
 *   aspect: "minecraft",
 *   target,
 *   mode: RepairModes.REPORT,
 * });
 * if (!verified.isValid) askUserBeforeFixing(verified.issues);
 * ```
 */
export const RepairModes = {
  FIX: "fix",
  REPORT: "report",
} as const;

/**
 * Repair-mode literal accepted by `kit.repair.runVerifyAndRepair`.
 *
 * @example
 * ```ts
 * import { RepairModes, type RepairMode } from "@loontail/minecraft-kit";
 *
 * const isReadOnly = (mode: RepairMode) => mode === RepairModes.REPORT;
 * ```
 */
export type RepairMode = (typeof RepairModes)[keyof typeof RepairModes];

/**
 * Inputs to `kit.repair.runVerifyAndRepair({ aspect, target, mode? })`. Runs a single
 * aspect's verifier and, in `'fix'` mode, plans + executes the repair for any issues it
 * finds. In `'report'` mode the function never writes to disk.
 *
 * @example
 * ```ts
 * import type { VerifyAndRepairInput } from "@loontail/minecraft-kit";
 *
 * const input: VerifyAndRepairInput = { aspect: "minecraft", target };
 * const { verified, repair } = await kit.repair.runVerifyAndRepair(input);
 * ```
 */
export type VerifyAndRepairInput = {
  readonly aspect: VerificationKind;
  readonly target: Target;
  readonly mode?: RepairMode;
  readonly signal?: AbortSignal;
  readonly onEvent?: ProgressListener;
};

/**
 * Result of `kit.repair.runVerifyAndRepair`. `verified` is always the verification result;
 * `repair` is the repair report when a fix ran, or `null` when nothing needed fixing or
 * `mode === RepairModes.REPORT`.
 *
 * @example
 * ```ts
 * import type { VerifyAndRepairResult } from "@loontail/minecraft-kit";
 *
 * const result: VerifyAndRepairResult = await kit.repair.runVerifyAndRepair({
 *   aspect: "runtime",
 *   target,
 * });
 * if (result.repair !== null) console.log(`fixed ${result.repair.actionsCompleted} files`);
 * ```
 */
export type VerifyAndRepairResult = {
  readonly verified: VerificationResult;
  readonly repair: RepairReport | null;
};

/**
 * Inputs to `kit.repair.fromError({ error, target })`. Resume a failed install by deriving
 * the smallest possible {@link RepairPlan} from a typed {@link MinecraftKitError} thrown by
 * a previous `kit.install.run` (or any other operation that surfaces the same codes).
 *
 * @example
 * ```ts
 * import { isMinecraftKitError } from "@loontail/minecraft-kit";
 *
 * try {
 *   await kit.install.run(plan);
 * } catch (error) {
 *   if (isMinecraftKitError(error)) {
 *     const resume = await kit.repair.fromError({ error, target });
 *     await kit.repair.minecraft.run(resume);
 *   } else throw error;
 * }
 * ```
 */
export type RepairFromErrorInput = {
  readonly error: RepairableErrorLike;
  readonly target: Target;
  readonly signal?: AbortSignal;
};
