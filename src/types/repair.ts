import type { MetadataCache } from "./cache";
import type { MinecraftKitErrorCode, MinecraftKitErrorContext } from "./errors";
import type { OperationOptions, ProgressListener } from "./events";
import type { HttpClient } from "./http";
import type { InstallAction, InstallPlan, InstallReport } from "./install";
import type { RuntimeFilesManifest } from "./runtime";
import type { Target } from "./target";
import type { VerificationFileResult, VerificationKind, VerificationResult } from "./verify";

/**
 * Coarse-grained repair phases used for `repair:phase-changed` events.
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
 */
export type RepairPhase = (typeof RepairPhases)[keyof typeof RepairPhases];

/**
 * A repair plan is, structurally, an install plan limited to actions needed to fix the
 * issues reported by a previous {@link VerificationResult}. The runner is the same.
 */
export type RepairPlan = {
  readonly targetId: string;
  readonly directory: string;
  readonly target: Target;
  readonly actions: readonly InstallAction[];
  readonly totalBytes: number;
  readonly totalActions: number;
  /**
   * Runtime files manifest carried over from the install plan this repair was derived from, so
   * running the repair never has to refetch it. Absent when the repair was derived without a
   * runtime resolution (e.g. `repair.fromError`).
   */
  readonly runtimeManifest?: RuntimeFilesManifest;
};

/**
 * Outcome summary returned by `repair.<aspect>.run`. Identical to {@link InstallReport} —
 * repair runs the same runner over a filtered plan.
 *
 * Interpreting `actionsSkipped` matters more here than on install: it counts actions inside
 * `actionsCompleted` that needed no work (a download whose on-disk hash already matched). A
 * Forge repair's defensive sweep deliberately re-emits every forge library, so
 * `actionsCompleted` alone cannot distinguish "re-downloaded 400 files" from "checked 400
 * files, fixed 2".
 */
export type RepairReport = InstallReport;

/**
 * Context passed to caller-owned repair filters.
 */
export type RepairIssueFilterInput = {
  readonly target: Target;
  readonly verification: VerificationResult;
  readonly issue: VerificationFileResult;
};

/**
 * Predicate used by repair planning to decide whether a verification issue belongs to
 * the kit-managed repair plan. Return `false` for files intentionally owned by the caller.
 */
export type RepairIssueFilter = (input: RepairIssueFilterInput) => boolean;

/**
 * Inputs accepted by every aspect-specific `planXxxRepair` (`planMinecraftRepair`,
 * `planFabricRepair`, `planForgeRepair`, `planRuntimeRepair`). The per-aspect input types
 * are aliases over this shape.
 */
export type AspectRepairInput = {
  readonly target: Target;
  readonly from: VerificationResult | readonly VerificationResult[];
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly signal?: AbortSignal;
  readonly shouldRepairIssue?: RepairIssueFilter;
  /** Host allow-list for the downloads repair planning performs (the Forge installer JAR). */
  readonly hostAllowList?: readonly string[];
  /**
   * Pre-built install plan to filter instead of building a fresh one. Supplied by
   * `repair.all`, which repairs several aspects from one plan — planning a Forge target is
   * expensive (installer fetch + `maven/` flush) and every aspect would otherwise pay it.
   * Planners only read from it, never mutate it.
   */
  readonly installPlan?: InstallPlan;
};

/**
 * Options for any `repair.<aspect>.plan` call. Accepts one or many verification results.
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
 * `kit.repair.all` actually accepts `RepairAllRunOptions`, which adds `pauseController`; that
 * type lives in `src/kit/repair-aspect.ts` because `PauseController` is a `src/core/` class and
 * `src/types/` must not import from `src/core/`.
 */
export type RepairAllOptions = OperationOptions & {
  readonly shouldRepairIssue?: RepairIssueFilter;
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
 * Modes accepted by `kit.repair.verifyAndRepair`.
 *
 * `'fix'` (default) — when verification surfaces issues, plan and execute the repair, then
 * return both the verification and the resulting repair report.
 *
 * `'report'` — only run verification; never touch disk. The returned `repair` is always
 * `null`. Useful for UIs that show the diagnosis first and ask the user before fixing.
 */
export const RepairModes = {
  FIX: "fix",
  REPORT: "report",
} as const;

/**
 * Repair-mode literal accepted by `kit.repair.verifyAndRepair`.
 */
export type RepairMode = (typeof RepairModes)[keyof typeof RepairModes];

/**
 * Inputs to `kit.repair.verifyAndRepair({ aspect, target, mode? })`. Runs a single
 * aspect's verifier and, in `'fix'` mode, plans + executes the repair for any issues it
 * finds. In `'report'` mode the function never writes to disk.
 */
export type VerifyAndRepairInput = {
  readonly aspect: VerificationKind;
  readonly target: Target;
  readonly mode?: RepairMode;
  readonly signal?: AbortSignal;
  readonly onEvent?: ProgressListener;
};

/**
 * Result of `kit.repair.verifyAndRepair`. `verification` is always the verification result;
 * `repair` is the repair report when a fix ran, or `null` when nothing needed fixing or
 * `mode === RepairModes.REPORT`.
 */
export type VerifyAndRepairResult = {
  readonly verification: VerificationResult;
  readonly repair: RepairReport | null;
};

/**
 * Inputs to `kit.repair.fromError({ error, target })`. Resume a failed install by deriving
 * the smallest possible {@link RepairPlan} from a typed {@link MinecraftKitError} thrown by
 * a previous `kit.install.run` (or any other operation that surfaces the same codes).
 */
export type RepairFromErrorInput = {
  readonly error: RepairableErrorLike;
  readonly target: Target;
  readonly signal?: AbortSignal;
};
