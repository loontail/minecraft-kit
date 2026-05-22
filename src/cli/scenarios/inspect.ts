import { formatUserError } from "../error-format";
import { formatDetailed } from "./install-helpers";
import type { ScenarioContext, ScenarioOutcome } from "./types";

/**
 * Scenario: inspect a single installation in detail.
 *
 * @internal
 */
export const scenarioInspect = async (ctx: ScenarioContext): Promise<ScenarioOutcome> => {
  try {
    const list = await ctx.kit.targets.list({ rootDir: ctx.rootDir });
    if (list.length === 0) {
      ctx.ui.log("warn", "No installations found. Install one first.");
      return "completed";
    }
    const choice = await ctx.ui.select({
      message: "Pick an installation to inspect",
      options: list.map((entry) => ({
        label: entry.id,
        value: entry.id,
        hint: entry.minecraftVersions.join(", ") || "no versions",
      })),
      allowCancel: true,
    });
    if (choice.kind !== "ok") return "cancelled";
    const entry = list.find((e) => e.id === choice.value);
    if (!entry) return "cancelled";
    ctx.ui.note(`Inspect: ${entry.id}`, formatDetailed(entry));
    return "completed";
  } catch (error) {
    ctx.ui.log("error", formatUserError(error));
    return "cancelled";
  }
};
