import { formatUserError } from "../../error-format";
import type { WizardOutcome } from "../../ui";
import type { ScenarioContext } from "../types";

/**
 * Pick a runtime component for an install plan. Returns `null` to mean "use whatever the
 * version manifest declares" (auto). Used by the install scenario.
 *
 * @internal
 */
export const pickRuntime = async (ctx: ScenarioContext): Promise<WizardOutcome<string | null>> => {
  const initial = await ctx.ui.select<"auto" | "specific">({
    message: "Select Java/runtime",
    options: [
      {
        label: "Use recommended",
        value: "auto",
        hint: "use the runtime declared by the version manifest",
      },
      {
        label: "Pick specific component…",
        value: "specific",
        hint: "choose from Mojang's published runtimes",
      },
    ],
    allowBack: true,
    allowCancel: true,
  });
  if (initial.kind !== "ok") return initial;
  if (initial.value === "auto") return { kind: "ok", value: null };

  const spinner = ctx.ui.spinner();
  spinner.start("Loading runtime components…");
  try {
    const list = await ctx.kit.versions.runtime.list({ system: ctx.kit.targets.system });
    spinner.stop(
      `${list.length} runtime entr${list.length === 1 ? "y" : "ies"} for your platform.`,
    );
    if (list.length === 0) {
      ctx.ui.log("warn", "No published runtimes for this platform — falling back to auto-detect.");
      return { kind: "ok", value: null };
    }
    const components = dedupeComponents(list);
    const choice = await ctx.ui.select<string>({
      message: "Select runtime component",
      options: components.map((c) => ({
        label: c.component,
        value: c.component,
        hint: c.versionName,
      })),
      allowBack: true,
      allowCancel: true,
    });
    if (choice.kind !== "ok") return choice;
    return { kind: "ok", value: choice.value };
  } catch (error) {
    spinner.stop("Failed to load runtimes.");
    ctx.ui.log("warn", `${formatUserError(error)} Falling back to auto-detect.`);
    return { kind: "ok", value: null };
  }
};

/**
 * Same as {@link pickRuntime} but always returns a component (no auto fallback).
 *
 * @internal
 */
export const pickRuntimeComponent = async (
  ctx: ScenarioContext,
): Promise<WizardOutcome<{ readonly component: string; readonly versionName: string }>> => {
  const spinner = ctx.ui.spinner();
  spinner.start("Loading runtime components…");
  let entries: Awaited<ReturnType<typeof ctx.kit.versions.runtime.list>>;
  try {
    entries = await ctx.kit.versions.runtime.list({ system: ctx.kit.targets.system });
    spinner.stop(
      `${entries.length} runtime entr${entries.length === 1 ? "y" : "ies"} for your platform.`,
    );
  } catch (error) {
    spinner.stop("Failed to load runtimes.");
    ctx.ui.log("error", formatUserError(error));
    return { kind: "cancel" };
  }
  if (entries.length === 0) {
    ctx.ui.log("warn", "No published runtimes for this platform.");
    return { kind: "cancel" };
  }
  const componentChoices = dedupeComponents(entries);
  const choice = await ctx.ui.select<string>({
    message: "Select Java runtime component",
    options: componentChoices.map((c) => ({
      label: c.component,
      value: c.component,
      hint: c.versionName,
    })),
    allowBack: true,
    allowCancel: true,
  });
  if (choice.kind !== "ok") return choice;
  const picked = componentChoices.find((c) => c.component === choice.value);
  if (!picked) return { kind: "cancel" };
  return { kind: "ok", value: picked };
};

/**
 * Pick where runtime files live — per-target dir or a shared install root.
 *
 * @internal
 */
export const pickRuntimeInstallRoot = async (
  ctx: ScenarioContext,
): Promise<WizardOutcome<string | null>> => {
  const choice = await ctx.ui.select<"per-target" | "custom">({
    message: "Where should the runtime files live?",
    options: [
      {
        label: "Per-target (default)",
        value: "per-target",
        hint: "<directory>/runtime/<component>",
      },
      {
        label: "Custom shared install root…",
        value: "custom",
        hint: "absolute path containing component directories",
      },
    ],
    allowBack: true,
    allowCancel: true,
  });
  if (choice.kind !== "ok") return choice;
  if (choice.value === "per-target") return { kind: "ok", value: null };
  const text = await ctx.ui.text({
    message: "Custom runtime install root (absolute path)",
    placeholder: "C:\\shared\\jre",
    validate: (s) => (s.trim().length === 0 ? "Path must be non-empty" : undefined),
    allowBack: true,
  });
  if (text.kind !== "ok") return text;
  const trimmed = (text.value ?? "").trim();
  if (trimmed.length === 0) return { kind: "ok", value: null };
  return { kind: "ok", value: trimmed };
};

/**
 * Mojang sometimes ships several entries per component (release history).
 * Keep the first (usually newest) per component for the picker.
 *
 * @internal
 */
const dedupeComponents = (
  entries: ReadonlyArray<{ readonly component: string; readonly versionName: string }>,
): { component: string; versionName: string }[] => {
  const seen = new Set<string>();
  const out: { component: string; versionName: string }[] = [];
  for (const entry of entries) {
    if (seen.has(entry.component)) continue;
    seen.add(entry.component);
    out.push({ component: entry.component, versionName: entry.versionName });
  }
  return out;
};
