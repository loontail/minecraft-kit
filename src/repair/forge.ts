import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { targetPaths } from "../core/paths";
import {
  type DownloadAction,
  DownloadCategories,
  type DownloadCategory,
  type InstallAction,
  InstallActionKinds,
  type RunForgeProcessorAction,
} from "../types/install";
import { Loaders } from "../types/loader";
import type { AspectRepairInput, RepairPlan } from "../types/repair";
import { type IssueIndex, planAspectRepair } from "./helpers";

const FORGE_DOWNLOAD_CATEGORIES = new Set<DownloadCategory>([DownloadCategories.FORGE_LIBRARY]);

/**
 * Inputs to {@link planForgeRepair}. Alias for {@link AspectRepairInput}.
 *
 * @internal
 */
export type PlanForgeRepairInput = AspectRepairInput;

/**
 * Build a repair plan covering the Forge loader slice: version JSON, libraries, and the Forge
 * processors that produce the final installation. A `forge-processor-output` issue re-runs only the
 * processors that declare the broken file; a missing version JSON re-runs all of them. In both
 * cases every forge-library download is added defensively — `downloadFile` skips files already on
 * disk.
 *
 * Throws `INVALID_INPUT` when the target is not a Forge install.
 *
 * Prefer `kit.repair.forge.plan(target, { from })` over importing this directly.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const verification = await kit.verify.forge.run(forgeTarget);
 * const plan = await kit.repair.forge.plan(forgeTarget, { from: verification });
 * await kit.repair.forge.run(plan);
 * ```
 */
export const planForgeRepair = async (input: PlanForgeRepairInput): Promise<RepairPlan> => {
  if (input.target.loader.type !== Loaders.FORGE) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `repair.forge requires a Forge target (got ${input.target.loader.type})`,
    );
  }
  const forgeJsonPath = targetPaths.versionJson(
    input.target.directory,
    input.target.loader.fullVersion,
  );

  return planAspectRepair(
    input,
    (action: InstallAction) => {
      if (action.kind === InstallActionKinds.DOWNLOAD_FILE) {
        return FORGE_DOWNLOAD_CATEGORIES.has(action.category);
      }
      if (action.kind === InstallActionKinds.WRITE_VERSION_JSON) {
        return action.path === forgeJsonPath;
      }
      return false;
    },
    ({ actions, installPlan, issues }) => {
      expandRepairForProcessors({ actions, installPlan, issues, forgeJsonPath });
    },
  );
};

/**
 * Pull Forge processors — and the libraries they consume — into the plan.
 *
 * Two triggers, both of which need the same expansion:
 *  - the Forge version JSON was missing during verify, so libraries could not be enumerated at
 *    all and the processors that regenerate the JSON have to run;
 *  - a generated processor output (`forge-processor-output` issue) is missing or hash-mismatched,
 *    in which case only the processors that declare a broken output are re-run.
 *
 * Either way every `FORGE_LIBRARY` download is re-emitted defensively: a processor's classpath and
 * inputs are install-time libraries that the verify pass does not necessarily cover, and running a
 * processor against a missing input fails with a Java stack trace instead of a repairable issue.
 * The regular skip-on-correct keeps the re-emission down to one hash per file.
 */
const expandRepairForProcessors = (input: {
  readonly actions: InstallAction[];
  readonly installPlan: { readonly actions: readonly InstallAction[] };
  readonly issues: IssueIndex;
  readonly forgeJsonPath: string;
}): void => {
  const { actions, installPlan, issues } = input;
  const forgeJsonMissing = issues.has(input.forgeJsonPath);
  const processors = installPlan.actions.filter(
    (action): action is RunForgeProcessorAction =>
      action.kind === InstallActionKinds.RUN_FORGE_PROCESSOR &&
      (forgeJsonMissing || Object.keys(action.outputs).some((output) => issues.has(output))),
  );
  if (!forgeJsonMissing && processors.length === 0) return;

  const alreadyIncluded = new Set(
    actions
      .filter((a): a is DownloadAction => a.kind === InstallActionKinds.DOWNLOAD_FILE)
      .map((a) => a.target),
  );
  for (const action of installPlan.actions) {
    if (
      action.kind === InstallActionKinds.DOWNLOAD_FILE &&
      action.category === DownloadCategories.FORGE_LIBRARY &&
      !alreadyIncluded.has(action.target)
    ) {
      actions.push(action);
    }
  }
  actions.push(...processors);
};
