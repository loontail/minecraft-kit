import { Loaders, type Target, type VerificationResult } from "../../index";
import { formatUserError } from "../error-format";
import { ProgressRenderer } from "../progress";
import { formatSummary } from "./install-helpers";
import { pickInstalledTarget } from "./pickers";
import type { ScenarioContext, ScenarioOutcome } from "./types";

/**
 * Run every verify aspect that applies to a target: always `minecraft` and `runtime`, plus
 * `fabric` / `forge` when the target uses that loader.
 */
const verifyAllAspects = async (
  ctx: ScenarioContext,
  target: Target,
): Promise<readonly VerificationResult[]> => {
  const results: VerificationResult[] = [];
  results.push(await ctx.kit.verify.minecraft.run(target));
  if (target.loader.type === Loaders.FABRIC) {
    results.push(await ctx.kit.verify.fabric.run(target));
  } else if (target.loader.type === Loaders.FORGE) {
    results.push(await ctx.kit.verify.forge.run(target));
  }
  results.push(await ctx.kit.verify.runtime.run(target));
  return results;
};

const summarizeVerifications = (
  results: readonly VerificationResult[],
): {
  readonly totalIssues: number;
  readonly perKind: ReadonlyArray<{ readonly kind: string; readonly count: number }>;
} => {
  const perKind = results.map((r) => ({ kind: r.kind, count: r.issues.length }));
  const totalIssues = perKind.reduce((sum, p) => sum + p.count, 0);
  return { totalIssues, perKind };
};

/**
 * Scenario: verify a discovered installation across minecraft, loader, and runtime.
 *
 * @internal
 */
export const scenarioVerify = async (ctx: ScenarioContext): Promise<ScenarioOutcome> => {
  const target = await pickInstalledTarget(ctx);
  if (!target) return "cancelled";
  const spinner = ctx.ui.spinner();
  spinner.start("Verifying…");
  try {
    const results = await verifyAllAspects(ctx, target);
    spinner.stop("Verification complete.");
    const { totalIssues, perKind } = summarizeVerifications(results);
    if (totalIssues === 0) {
      ctx.ui.log("success", `${target.id} is clean.`);
    } else {
      const breakdown = perKind
        .filter((p) => p.count > 0)
        .map((p) => `${p.kind}: ${p.count}`)
        .join(", ");
      ctx.ui.log(
        "warn",
        `${target.id}: ${totalIssues} issue(s) (${breakdown}). Run "Repair" to fix.`,
      );
    }
    return "completed";
  } catch (error) {
    spinner.stop("Verification failed.");
    ctx.ui.log("error", formatUserError(error));
    return "cancelled";
  }
};

/**
 * Scenario: repair a discovered installation.
 *
 * @internal
 */
export const scenarioRepair = async (ctx: ScenarioContext): Promise<ScenarioOutcome> => {
  const target = await pickInstalledTarget(ctx);
  if (!target) return "cancelled";
  const verifySpinner = ctx.ui.spinner();
  verifySpinner.start("Verifying installation…");
  try {
    const verifications = await verifyAllAspects(ctx, target);
    const { totalIssues, perKind } = summarizeVerifications(verifications);
    if (totalIssues === 0) {
      verifySpinner.stop("Nothing to repair.");
      ctx.ui.log("success", "Installation is already clean.");
      return "completed";
    }
    const breakdown = perKind
      .filter((p) => p.count > 0)
      .map((p) => `${p.kind}: ${p.count}`)
      .join(", ");
    verifySpinner.stop(`Found ${totalIssues} issue(s) — ${breakdown}.`);
    const ok = await ctx.ui.confirm({ message: `Repair ${totalIssues} item(s)?`, initial: true });
    if (ok.kind !== "ok" || !ok.value) return "cancelled";

    type RepairAspectKey = "minecraft" | "fabric" | "forge" | "runtime";
    const aspectKeys: readonly RepairAspectKey[] = ["minecraft", "fabric", "forge", "runtime"];
    const aspects: ReadonlyArray<{
      readonly key: RepairAspectKey;
      readonly verification?: VerificationResult;
    }> = aspectKeys.map((key) => {
      const verification = verifications.find((v) => v.kind === key);
      return verification !== undefined ? { key, verification } : { key };
    });

    for (const aspect of aspects) {
      if (!aspect.verification || aspect.verification.issues.length === 0) continue;
      const plan = await ctx.kit.repair[aspect.key].plan(target, { from: aspect.verification });
      if (plan.totalActions === 0) continue;
      const renderer = new ProgressRenderer({
        ui: ctx.ui,
        label: `Repair ${aspect.key}`,
        totalActions: plan.totalActions,
        totalBytes: plan.totalBytes,
      });
      const onEvent = renderer.attach();
      try {
        await ctx.kit.repair[aspect.key].run(plan, { onEvent });
        const summary = renderer.finish();
        ctx.ui.note(`Repair ${aspect.key} summary`, formatSummary(summary));
      } catch (error) {
        renderer.fail(formatUserError(error));
        throw error;
      }
    }
    return "completed";
  } catch (error) {
    ctx.ui.log("error", formatUserError(error));
    return "cancelled";
  }
};
