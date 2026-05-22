import path from "node:path";
import { assertNever } from "../../core/assert-never";
import { Loaders } from "../../types/loader";
import type { MinecraftChannel, MinecraftVersionSummary } from "../../types/minecraft";
import { formatUserError } from "../error-format";
import {
  defaultIdFor,
  defaultIdFromSelection,
  previousFromDirectory,
  runInstallFromSelection,
  runStandaloneRuntimeInstallWithProgress,
  summaryRows,
} from "./install-helpers";
import {
  confirmInstall,
  pickChannel,
  pickDirectory,
  pickFabricLoader,
  pickForgeBuild,
  pickInstallType,
  pickMinecraftVersion,
  pickRuntime,
  pickRuntimeComponent,
  pickRuntimeInstallRoot,
} from "./pickers";
import {
  type InstallSelection,
  type InstallWizardStep,
  InstallWizardSteps,
  type ScenarioContext,
  type ScenarioOutcome,
} from "./types";

const emptySelection = (): InstallSelection => ({
  channel: null,
  version: null,
  runtimeOverride: null,
  installType: null,
  fabricLoader: null,
  forgeBuild: null,
  forgeLabel: null,
  directory: null,
});

/**
 * Unified install scenario: covers vanilla, Fabric, and Forge through a single wizard.
 *
 * @internal
 */
export const scenarioInstallMinecraft = async (ctx: ScenarioContext): Promise<ScenarioOutcome> => {
  const sel = emptySelection();
  let step: InstallWizardStep = InstallWizardSteps.CHANNEL;
  while (true) {
    const next = await advanceInstallWizard(ctx, sel, step);
    if (next === "completed" || next === "cancelled") return next;
    step = next;
  }
};

const advanceInstallWizard = async (
  ctx: ScenarioContext,
  sel: InstallSelection,
  step: InstallWizardStep,
): Promise<InstallWizardStep | ScenarioOutcome> => {
  switch (step) {
    case InstallWizardSteps.CHANNEL: {
      const r = await pickChannel(ctx.ui);
      if (r.kind !== "ok") return "cancelled";
      sel.channel = r.value;
      return InstallWizardSteps.VERSION;
    }
    case InstallWizardSteps.VERSION: {
      const r = await pickMinecraftVersion(ctx, sel.channel as MinecraftChannel | "old" | "all");
      if (r.kind === "cancel") return "cancelled";
      if (r.kind === "back") return InstallWizardSteps.CHANNEL;
      sel.version = r.value;
      return InstallWizardSteps.RUNTIME;
    }
    case InstallWizardSteps.RUNTIME: {
      const r = await pickRuntime(ctx);
      if (r.kind === "cancel") return "cancelled";
      if (r.kind === "back") return InstallWizardSteps.VERSION;
      sel.runtimeOverride = r.value;
      return InstallWizardSteps.INSTALL_TYPE;
    }
    case InstallWizardSteps.INSTALL_TYPE: {
      const r = await pickInstallType(ctx.ui);
      if (r.kind === "cancel") return "cancelled";
      if (r.kind === "back") return InstallWizardSteps.RUNTIME;
      sel.installType = r.value;
      if (r.value === Loaders.VANILLA) return InstallWizardSteps.DIRECTORY;
      if (r.value === Loaders.FABRIC) return InstallWizardSteps.FABRIC_LOADER;
      return InstallWizardSteps.FORGE_BUILD;
    }
    case InstallWizardSteps.FABRIC_LOADER: {
      const version = (sel.version as MinecraftVersionSummary).id;
      const r = await pickFabricLoader(ctx, version);
      if (r.kind === "cancel") return "cancelled";
      if (r.kind === "back") return InstallWizardSteps.INSTALL_TYPE;
      if (r.kind === "incompatible") {
        ctx.ui.log(
          "warn",
          `Fabric is not available for Minecraft ${version}. Pick another version or install type.`,
        );
        return InstallWizardSteps.INSTALL_TYPE;
      }
      sel.fabricLoader = r.value;
      return InstallWizardSteps.DIRECTORY;
    }
    case InstallWizardSteps.FORGE_BUILD: {
      const version = (sel.version as MinecraftVersionSummary).id;
      const r = await pickForgeBuild(ctx, version);
      if (r.kind === "cancel") return "cancelled";
      if (r.kind === "back") return InstallWizardSteps.INSTALL_TYPE;
      if (r.kind === "incompatible") {
        ctx.ui.log(
          "warn",
          `Forge is not available for Minecraft ${version}. Pick another version or install type.`,
        );
        return InstallWizardSteps.INSTALL_TYPE;
      }
      sel.forgeBuild = r.value;
      sel.forgeLabel = r.label;
      return InstallWizardSteps.DIRECTORY;
    }
    case InstallWizardSteps.DIRECTORY: {
      const r = await pickDirectory(ctx, defaultIdFromSelection(sel));
      if (r.kind === "cancel") return "cancelled";
      if (r.kind === "back") return previousFromDirectory(sel);
      sel.directory = r.value;
      return InstallWizardSteps.SUMMARY;
    }
    case InstallWizardSteps.SUMMARY: {
      const ok = await confirmInstall(ctx, summaryRows(sel));
      if (ok.kind === "cancel") return "cancelled";
      if (ok.kind === "back") return InstallWizardSteps.DIRECTORY;
      if (!ok.value) return "cancelled";
      const result = await runInstallFromSelection(ctx, sel);
      if (result === "ok") return "completed";
      if (result === "cancelled") return "cancelled";
      return result;
    }
    default:
      return assertNever(step);
  }
};

const RuntimeWizardSteps = {
  COMPONENT: "component",
  DIRECTORY: "directory",
  INSTALL_ROOT: "install-root",
  SUMMARY: "summary",
} as const;

type RuntimeWizardStep = (typeof RuntimeWizardSteps)[keyof typeof RuntimeWizardSteps];

type RuntimeSelection = {
  component: string | null;
  versionLabel: string | null;
  directory: string | null;
  installRoot: string | null;
};

/**
 * Standalone: install a Mojang Java runtime directly, without going through a Minecraft
 * version. The user picks a runtime component, a destination directory, and an optional
 * shared install root — that's it.
 *
 * @internal
 */
export const scenarioInstallRuntime = async (ctx: ScenarioContext): Promise<ScenarioOutcome> => {
  const sel: RuntimeSelection = {
    component: null,
    versionLabel: null,
    directory: null,
    installRoot: null,
  };
  let step: RuntimeWizardStep = RuntimeWizardSteps.COMPONENT;
  while (true) {
    const next = await advanceRuntimeWizard(ctx, sel, step);
    if (next === "completed" || next === "cancelled") return next;
    step = next;
  }
};

const advanceRuntimeWizard = async (
  ctx: ScenarioContext,
  sel: RuntimeSelection,
  step: RuntimeWizardStep,
): Promise<RuntimeWizardStep | ScenarioOutcome> => {
  switch (step) {
    case RuntimeWizardSteps.COMPONENT: {
      const r = await pickRuntimeComponent(ctx);
      if (r.kind !== "ok") return "cancelled";
      sel.component = r.value.component;
      sel.versionLabel = r.value.versionName;
      return RuntimeWizardSteps.DIRECTORY;
    }
    case RuntimeWizardSteps.DIRECTORY: {
      const r = await pickDirectory(ctx, defaultIdFor("runtime", sel.component ?? "java"));
      if (r.kind === "cancel") return "cancelled";
      if (r.kind === "back") return RuntimeWizardSteps.COMPONENT;
      sel.directory = r.value;
      return RuntimeWizardSteps.INSTALL_ROOT;
    }
    case RuntimeWizardSteps.INSTALL_ROOT: {
      const r = await pickRuntimeInstallRoot(ctx);
      if (r.kind === "cancel") return "cancelled";
      if (r.kind === "back") return RuntimeWizardSteps.DIRECTORY;
      sel.installRoot = r.value;
      return RuntimeWizardSteps.SUMMARY;
    }
    case RuntimeWizardSteps.SUMMARY: {
      const dir = sel.directory as string;
      const comp = sel.component as string;
      const ok = await confirmInstall(ctx, [
        ["Goal", "Install Mojang Java runtime"],
        ["Component", `${comp}${sel.versionLabel ? ` (${sel.versionLabel})` : ""}`],
        ["Directory", dir],
        ["Install root", sel.installRoot ?? `${dir}/runtime (per-target)`],
      ]);
      if (ok.kind === "cancel") return "cancelled";
      if (ok.kind === "back") return RuntimeWizardSteps.INSTALL_ROOT;
      if (!ok.value) return "cancelled";
      try {
        const runtime = await ctx.kit.versions.runtime.resolve({
          system: ctx.kit.targets.system,
          component: comp,
        });
        const finalRuntime: typeof runtime =
          sel.installRoot !== null ? { ...runtime, installRoot: sel.installRoot } : runtime;
        await runStandaloneRuntimeInstallWithProgress(ctx, {
          id: path.basename(dir),
          directory: dir,
          runtime: finalRuntime,
        });
        return "completed";
      } catch (error) {
        ctx.ui.log("error", formatUserError(error));
        return RuntimeWizardSteps.COMPONENT;
      }
    }
    default:
      return assertNever(step);
  }
};
