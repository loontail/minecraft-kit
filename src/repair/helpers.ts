import { withOptionalHostAllowList, withOptionalSignal } from "../core/optional";
import { planInstall } from "../install/planner";
import { type InstallAction, InstallActionKinds, type InstallPlan } from "../types/install";
import type { AspectRepairInput, RepairIssueFilter, RepairPlan } from "../types/repair";
import type { RuntimeFilesManifest } from "../types/runtime";
import type { Target } from "../types/target";
import {
  type VerificationResult,
  VerifyFileCategories,
  type VerifyFileCategory,
} from "../types/verify";

/**
 * Normalize the `from` option of a repair plan into an array.
 *
 * @internal
 */
const asResultArray = (
  from: VerificationResult | readonly VerificationResult[],
): readonly VerificationResult[] => {
  // why: Array.isArray narrows to a mutable array, so it leaves the readonly member of the
  // union in the else branch; discriminate on a required field of the single-result shape.
  return "targetId" in from ? [from] : from;
};

/**
 * Category-aware view over a set of verification results. Lets repair distinguish
 *  - paths that need a download (have any non-`native` category recorded), from
 *  - paths whose only issue is `native` extraction (the JAR is fine, but the extracted
 *    natives directory is missing).
 *
 * Without this distinction, a "natives directory missing" report would re-trigger every
 * native-jar download even though every JAR on disk is already correct.
 *
 * @internal
 */
export type IssueIndex = {
  /** True when any verification result reported an issue at `path`. */
  has(path: string): boolean;
  /**
   * True when at least one issue at `path` carries a category other than `native`.
   * Used to decide whether a `DOWNLOAD_FILE` action should fire — a `native`-only issue
   * means "re-extract the JAR" not "re-download the JAR".
   */
  hasNonNative(path: string): boolean;
};

/**
 * Build an {@link IssueIndex} from one or more verification results.
 *
 * @internal
 */
const buildIssueIndex = (from: VerificationResult | readonly VerificationResult[]): IssueIndex => {
  const map = new Map<string, Set<VerifyFileCategory>>();
  for (const v of asResultArray(from)) {
    for (const issue of v.issues) {
      const set = map.get(issue.path);
      if (set) set.add(issue.category);
      else map.set(issue.path, new Set([issue.category]));
    }
  }
  return {
    has: (path) => map.has(path),
    hasNonNative: (path) => {
      const cats = map.get(path);
      if (!cats) return false;
      for (const c of cats) {
        if (c !== VerifyFileCategories.NATIVE) return true;
      }
      return false;
    },
  };
};

/**
 * Apply a caller-owned issue filter while preserving the verification shape expected by
 * repair planners.
 *
 * @internal
 */
export const filterRepairIssueResults = (input: {
  readonly target: Target;
  readonly from: VerificationResult | readonly VerificationResult[];
  readonly shouldRepairIssue?: RepairIssueFilter;
}): readonly VerificationResult[] => {
  const results = asResultArray(input.from);
  const shouldRepairIssue = input.shouldRepairIssue;
  if (shouldRepairIssue === undefined) return results;
  return results.map((result) => {
    const issues = result.issues.filter((issue) =>
      shouldRepairIssue({ target: input.target, verification: result, issue }),
    );
    if (issues.length === result.issues.length) return result;
    return {
      ...result,
      isValid: issues.length === 0,
      issues,
    };
  });
};

/**
 * Sum expected bytes of all DOWNLOAD_FILE actions in a list.
 *
 * @internal
 */
const sumDownloadBytes = (actions: readonly InstallAction[]): number => {
  return actions.reduce((sum, action) => {
    if (action.kind === InstallActionKinds.DOWNLOAD_FILE) {
      return sum + (action.expectedSize ?? 0);
    }
    return sum;
  }, 0);
};

/**
 * Wrap a list of install actions in a {@link RepairPlan} for the given target. `runtimeManifest`
 * is carried over from the install plan the actions were selected from so `runRepair` never has
 * to refetch it — pass `undefined` when no install plan was involved.
 *
 * @internal
 */
export const buildRepairPlan = (
  target: Target,
  actions: readonly InstallAction[],
  runtimeManifest?: RuntimeFilesManifest,
): RepairPlan => {
  return {
    targetId: target.id,
    directory: target.directory,
    target,
    actions,
    totalActions: actions.length,
    totalBytes: sumDownloadBytes(actions),
    ...(runtimeManifest !== undefined ? { runtimeManifest } : {}),
  };
};

/**
 * Predicate to keep only actions belonging to a specific repair aspect.
 *
 * @internal
 */
export type AspectFilter = (action: InstallAction) => boolean;

/**
 * Run the boilerplate every aspect-specific repair planner shares:
 *   1. Reuse `input.installPlan` when the caller supplied one, else build a full install plan.
 *   2. Index the verification issues.
 *   3. Filter install actions through the aspect-specific predicate using the standard
 *      DOWNLOAD / WRITE / EXTRACT_NATIVE selection rules.
 *   4. Let the caller append any aspect-specific actions (e.g. Forge's defensive sweep).
 *   5. Wrap the actions in a {@link RepairPlan}.
 *
 * @internal
 */
export const planAspectRepair = async (
  input: AspectRepairInput,
  aspectFilter: AspectFilter,
  postprocess?: (selection: {
    actions: InstallAction[];
    installPlan: InstallPlan;
    issues: IssueIndex;
  }) => void,
): Promise<RepairPlan> => {
  const installPlan =
    input.installPlan ??
    (await planInstall({
      target: input.target,
      http: input.http,
      cache: input.cache,
      ...withOptionalSignal(input.signal),
      ...withOptionalHostAllowList(input.hostAllowList),
    }));
  const issues = buildIssueIndex(filterRepairIssueResults(input));
  const actions = selectRepairActions({
    target: input.target,
    installPlan,
    issues,
    aspectFilter,
  });
  postprocess?.({ actions, installPlan, issues });
  return buildRepairPlan(input.target, actions, installPlan.runtimeManifest);
};

/**
 * Apply the standard repair-action selection rules, restricted to the actions accepted by
 * `aspectFilter`. The rules are:
 *  - DOWNLOAD_FILE: include if the target path has any non-`native` issue recorded.
 *  - WRITE_VERSION_JSON: include if the destination path has any issue recorded.
 *  - EXTRACT_NATIVE: include if the source JAR has any issue recorded.
 *  - Anything else admitted by `aspectFilter` is included unconditionally.
 *
 * @internal
 */
const selectRepairActions = (input: {
  readonly target: Target;
  readonly installPlan: InstallPlan;
  readonly issues: IssueIndex;
  readonly aspectFilter: AspectFilter;
}): InstallAction[] => {
  const matching: InstallAction[] = [];
  for (const action of input.installPlan.actions) {
    if (!input.aspectFilter(action)) continue;
    if (action.kind === InstallActionKinds.DOWNLOAD_FILE) {
      if (input.issues.hasNonNative(action.target)) {
        matching.push(action);
      }
    } else if (action.kind === InstallActionKinds.WRITE_VERSION_JSON) {
      if (input.issues.has(action.path)) {
        matching.push(action);
      }
    } else if (action.kind === InstallActionKinds.EXTRACT_NATIVE) {
      if (input.issues.has(action.source)) {
        matching.push(action);
      }
    } else {
      matching.push(action);
    }
  }
  return matching;
};
