import path from "node:path";
import { Loaders } from "../../types/loader";
import type { MinecraftVersionSummary } from "../../types/minecraft";
import type { ResolvedRuntime } from "../../types/runtime";
import type { DiscoveredTarget, Target } from "../../types/target";
import { formatUserError } from "../error-format";
import { ProgressRenderer, type ProgressSummary, formatBytes, formatDuration } from "../progress";
import {
  type InstallRunResult,
  InstallRunResults,
  type InstallSelection,
  type InstallType,
  type InstallWizardStep,
  InstallWizardSteps,
  type ScenarioContext,
} from "./types";

/**
 * Plan + run an install and pipe progress events into the {@link ProgressRenderer}.
 * Throws if either step fails; the renderer's `fail()` message is the user-facing error.
 *
 * @internal
 */
export const runInstallWithProgress = async (
  ctx: ScenarioContext,
  target: Target,
  label: string,
): Promise<void> => {
  const planSpinner = ctx.ui.spinner();
  planSpinner.start(`Planning ${label}…`);
  let plan: Awaited<ReturnType<typeof ctx.kit.install.plan>>;
  try {
    plan = await ctx.kit.install.plan(target);
    planSpinner.stop(`Plan ready: ${plan.totalActions} actions, ${formatBytes(plan.totalBytes)}.`);
  } catch (error) {
    planSpinner.stop("Planning failed.");
    ctx.ui.log("error", formatUserError(error));
    throw error;
  }
  const renderer = new ProgressRenderer({
    ui: ctx.ui,
    label: `Install ${label}`,
    totalActions: plan.totalActions,
    totalBytes: plan.totalBytes,
  });
  const onEvent = renderer.attach();
  try {
    await ctx.kit.install.run(plan, { onEvent });
    const summary = renderer.finish();
    ctx.ui.note("Install summary", formatSummary(summary));
  } catch (error) {
    renderer.fail(formatUserError(error));
    throw error;
  }
};

/**
 * Resolve a target from the wizard selection and execute the install. Returns:
 *   - `"ok"`        install completed
 *   - `"cancelled"` install failed; the underlying error is already logged. The wizard
 *                   should exit to the main menu rather than re-prompt the same steps —
 *                   retrying without changing inputs almost never recovers.
 *   - `"install-type"` target resolution failed; loader choice probably needs to change.
 *
 * @internal
 */
export const runInstallFromSelection = async (
  ctx: ScenarioContext,
  sel: InstallSelection,
): Promise<InstallRunResult> => {
  const v = sel.version as MinecraftVersionSummary;
  const dir = sel.directory as string;
  const loaderInput = buildLoaderInput(sel);
  const runtimeInput =
    sel.runtimeOverride !== null ? { runtime: { component: sel.runtimeOverride } } : {};
  let target: Target;
  try {
    target = await ctx.kit.targets.resolve({
      id: path.basename(dir),
      directory: dir,
      minecraft: { version: v.id },
      loader: loaderInput,
      ...runtimeInput,
    });
  } catch (error) {
    ctx.ui.log("error", formatUserError(error));
    return InstallRunResults.INSTALL_TYPE;
  }
  try {
    await runInstallWithProgress(ctx, target, describeLoader(sel));
    return InstallRunResults.OK;
  } catch {
    return InstallRunResults.CANCELLED;
  }
};

/** @internal */
export const runStandaloneRuntimeInstallWithProgress = async (
  ctx: ScenarioContext,
  input: { readonly id: string; readonly directory: string; readonly runtime: ResolvedRuntime },
): Promise<void> => {
  const label = `runtime ${input.runtime.component}`;
  const planSpinner = ctx.ui.spinner();
  planSpinner.start(`Planning ${label}…`);
  let plan: Awaited<ReturnType<typeof ctx.kit.install.runtime.standalonePlan>>;
  try {
    plan = await ctx.kit.install.runtime.standalonePlan({
      id: input.id,
      directory: input.directory,
      runtime: input.runtime,
    });
    planSpinner.stop(`Plan ready: ${plan.totalActions} files, ${formatBytes(plan.totalBytes)}.`);
  } catch (error) {
    planSpinner.stop("Planning failed.");
    ctx.ui.log("error", formatUserError(error));
    throw error;
  }
  const renderer = new ProgressRenderer({
    ui: ctx.ui,
    label: `Install ${label}`,
    totalActions: plan.totalActions,
    totalBytes: plan.totalBytes,
  });
  const onEvent = renderer.attach();
  try {
    await ctx.kit.install.runtime.run(plan, { onEvent });
    const summary = renderer.finish();
    ctx.ui.note("Runtime install summary", formatSummary(summary));
  } catch (error) {
    renderer.fail(formatUserError(error));
    throw error;
  }
};

/** @internal */
export const buildLoaderInput = (
  sel: InstallSelection,
): {
  readonly type: InstallType;
  readonly version?: string;
} => {
  if (sel.installType === Loaders.VANILLA) {
    return { type: Loaders.VANILLA };
  }
  if (sel.installType === Loaders.FABRIC) {
    return { type: Loaders.FABRIC, version: sel.fabricLoader as string };
  }
  return { type: Loaders.FORGE, version: sel.forgeBuild as string };
};

/** @internal */
export const describeLoader = (sel: InstallSelection): string => {
  const v = (sel.version as MinecraftVersionSummary).id;
  if (sel.installType === Loaders.VANILLA) return `Vanilla ${v}`;
  if (sel.installType === Loaders.FABRIC) return `Fabric ${sel.fabricLoader} on ${v}`;
  return `Forge ${sel.forgeLabel ?? sel.forgeBuild} on ${v}`;
};

/** @internal */
export const summaryRows = (sel: InstallSelection): readonly (readonly [string, string])[] => {
  const v = sel.version as MinecraftVersionSummary;
  const rows: [string, string][] = [
    ["Minecraft", v.id],
    ["Type", labelForType(sel.installType)],
  ];
  if (sel.installType === Loaders.FABRIC && sel.fabricLoader) {
    rows.push(["Fabric", sel.fabricLoader]);
  }
  if (sel.installType === Loaders.FORGE && (sel.forgeLabel || sel.forgeBuild)) {
    rows.push(["Forge", sel.forgeLabel ?? sel.forgeBuild ?? ""]);
  }
  rows.push(["Runtime", sel.runtimeOverride ?? "auto-detect"]);
  rows.push(["Directory", sel.directory as string]);
  return rows;
};

const labelForType = (type: InstallType | null): string => {
  if (type === Loaders.FABRIC) return "Fabric";
  if (type === Loaders.FORGE) return "Forge (modern)";
  return "Vanilla";
};

/** @internal */
export const previousFromDirectory = (sel: InstallSelection): InstallWizardStep => {
  if (sel.installType === Loaders.FABRIC) return InstallWizardSteps.FABRIC_LOADER;
  if (sel.installType === Loaders.FORGE) return InstallWizardSteps.FORGE_BUILD;
  return InstallWizardSteps.INSTALL_TYPE;
};

/** @internal */
export const defaultIdFromSelection = (sel: InstallSelection): string => {
  const v = (sel.version as MinecraftVersionSummary).id;
  if (sel.installType === Loaders.FABRIC) {
    return defaultIdFor("fabric", `${v}-${sel.fabricLoader ?? ""}`);
  }
  if (sel.installType === Loaders.FORGE) {
    return defaultIdFor("forge", `${v}-${sel.forgeBuild ?? ""}`);
  }
  return defaultIdFor("vanilla", v);
};

/** @internal */
export const defaultIdFor = (loader: string, suffix: string): string => {
  return `${loader}-${suffix}`.replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase();
};

/** @internal */
export const formatDetailed = (entry: DiscoveredTarget): string => {
  const versions =
    entry.minecraftVersions.length === 0 ? "(none)" : entry.minecraftVersions.join(", ");
  const loaders =
    entry.loaders.length === 0
      ? "(none)"
      : entry.loaders.map((l) => `${l.type}${l.version ? ` ${l.version}` : ""}`).join(", ");
  const runtimePath = entry.runtime?.javaPath ?? "(none detected)";
  const runtimeComponent = entry.runtime?.component ?? "(unknown)";
  const runtimeVersion = entry.runtime?.javaVersion ?? "(unknown)";
  return [
    `Directory:         ${entry.directory}`,
    `Minecraft:         ${versions}`,
    `Loaders:           ${loaders}`,
    `Runtime path:      ${runtimePath}`,
    `Runtime component: ${runtimeComponent}`,
    `Runtime version:   ${runtimeVersion}`,
  ].join("\n");
};

/** @internal */
export const formatSummary = (summary: ProgressSummary): string => {
  const lines = [
    `Files downloaded: ${summary.filesDownloaded}`,
    `Files skipped:    ${summary.filesSkipped}`,
  ];
  if (summary.filesFailed > 0) {
    lines.push(`Files failed:     ${summary.filesFailed}`);
  }
  lines.push(
    `Bytes downloaded: ${formatBytes(summary.bytesDownloaded)}`,
    `Average speed:    ${formatBytes(summary.avgSpeedBps)}/s`,
    `Duration:         ${formatDuration(summary.durationMs)}`,
  );
  return lines.join("\n");
};
