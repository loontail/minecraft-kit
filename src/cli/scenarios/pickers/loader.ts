import { Loaders } from "../../../types/loader";
import { formatUserError } from "../../error-format";
import type { SelectOption, Ui, WizardOutcome } from "../../ui";
import type { InstallType, ScenarioContext } from "../types";

/**
 * Outcome of {@link pickFabricLoader}.
 *
 * @internal
 */
export type FabricLoaderOutcome = WizardOutcome<string> | { readonly kind: "incompatible" };

/**
 * Outcome of {@link pickForgeBuild}.
 *
 * @internal
 */
export type ForgeBuildOutcome =
  | { readonly kind: "ok"; readonly value: string; readonly label: string }
  | { readonly kind: "back" }
  | { readonly kind: "cancel" }
  | { readonly kind: "incompatible" };

/**
 * Choose between Vanilla / Fabric / Forge.
 *
 * @internal
 */
export const pickInstallType = async (ui: Ui): Promise<WizardOutcome<InstallType>> => {
  return ui.select<InstallType>({
    message: "Select installation type",
    options: [
      { label: "Vanilla", value: Loaders.VANILLA, hint: "no mod loader" },
      {
        label: "Fabric",
        value: Loaders.FABRIC,
        hint: "lightweight modern loader",
      },
      { label: "Forge", value: Loaders.FORGE, hint: "modern Forge (1.13+)" },
    ],
    allowBack: true,
    allowCancel: true,
  });
};

/**
 * Pick a Fabric loader version for the given Minecraft version.
 *
 * @internal
 */
export const pickFabricLoader = async (
  ctx: ScenarioContext,
  minecraftVersion: string,
): Promise<FabricLoaderOutcome> => {
  const spinner = ctx.ui.spinner();
  spinner.start(`Loading Fabric loaders for ${minecraftVersion}…`);
  try {
    const loaders = await ctx.kit.versions.fabric.list({ minecraftVersion });
    spinner.stop(`${loaders.length} Fabric loader(s).`);
    if (loaders.length === 0) {
      return { kind: "incompatible" };
    }
    const options: SelectOption<string>[] = loaders.map((loader) => ({
      label: loader.version,
      value: loader.version,
      hint: loader.stable ? "stable" : "unstable",
    }));
    return await ctx.ui.searchableSelect({
      message: "Select Fabric loader",
      options,
      allowBack: true,
      allowCancel: true,
    });
  } catch (error) {
    spinner.stop("Failed to load Fabric loaders.");
    // Conflate network failure with "loader not available" — both block the wizard from
    // moving forward, and the warning surfaces the underlying error message either way.
    ctx.ui.log("warn", formatUserError(error));
    return { kind: "incompatible" };
  }
};

/**
 * Pick a Forge build for the given Minecraft version, surfacing recommended + latest.
 *
 * @internal
 */
export const pickForgeBuild = async (
  ctx: ScenarioContext,
  minecraftVersion: string,
): Promise<ForgeBuildOutcome> => {
  const spinner = ctx.ui.spinner();
  spinner.start(`Loading Forge builds for ${minecraftVersion}…`);
  try {
    const builds = await ctx.kit.versions.forge.list({ minecraftVersion });
    spinner.stop(`${builds.length} Forge build(s).`);
    if (builds.length === 0) {
      return { kind: "incompatible" };
    }
    const options = buildForgeOptions(builds);
    const result = await ctx.ui.searchableSelect({
      message: "Select Forge build",
      options,
      allowBack: true,
      allowCancel: true,
    });
    if (result.kind !== "ok") return result;
    const matched = options.find((o) => o.value === result.value);
    return {
      kind: "ok",
      value: result.value,
      label: matched?.label ?? result.value,
    };
  } catch (error) {
    spinner.stop("Failed to load Forge builds.");
    ctx.ui.log("warn", formatUserError(error));
    return { kind: "incompatible" };
  }
};

const buildForgeOptions = (
  builds: Awaited<ReturnType<ScenarioContext["kit"]["versions"]["forge"]["list"]>>,
): SelectOption<string>[] => {
  const recommended = builds.find((b) => b.isRecommended);
  const latest = builds.find((b) => b.isLatest);
  const options: SelectOption<string>[] = [];
  if (recommended) {
    options.push({
      label: `Recommended (${recommended.forgeVersion})`,
      value: recommended.forgeVersion,
      hint: "promoted -recommended",
    });
  }
  if (latest && latest.forgeVersion !== recommended?.forgeVersion) {
    options.push({
      label: `Latest (${latest.forgeVersion})`,
      value: latest.forgeVersion,
      hint: "promoted -latest",
    });
  }
  for (const build of builds) {
    if (build.isRecommended || build.isLatest) continue;
    options.push({
      label: build.forgeVersion,
      value: build.forgeVersion,
      hint: build.fullVersion,
    });
  }
  return options;
};
