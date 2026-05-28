import path from "node:path";
import { type DiscoveredTarget, Loaders, type Target, VersionPreference } from "../../../index";
import { formatUserError } from "../../error-format";
import type { WizardOutcome } from "../../ui";
import type { ScenarioContext } from "../types";
import { pickMinecraftVersionFromEntry } from "./version";

/**
 * Pick the install directory: default `<root>/<id>` or a user-typed path.
 *
 * @internal
 */
export const pickDirectory = async (
  ctx: ScenarioContext,
  suggestedId: string,
): Promise<WizardOutcome<string>> => {
  const defaultPath = path.join(ctx.rootDir, suggestedId);
  const choice = await ctx.ui.select<"default" | "custom">({
    message: "Where should the installation live?",
    options: [
      { label: `Default: ${defaultPath}`, value: "default" },
      { label: "Custom path…", value: "custom" },
    ],
    allowBack: true,
    allowCancel: true,
  });
  if (choice.kind !== "ok") return choice;
  if (choice.value === "default") return { kind: "ok", value: defaultPath };
  const text = await ctx.ui.text({
    message: "Custom installation directory",
    placeholder: defaultPath,
    initial: defaultPath,
    validate: (s) => (s.trim().length === 0 ? "Path must be non-empty" : undefined),
    allowBack: true,
  });
  if (text.kind !== "ok") return text;
  return { kind: "ok", value: (text.value ?? "").trim() };
};

/**
 * Show a summary table and confirm before kicking off an install.
 *
 * @internal
 */
export const confirmInstall = async (
  ctx: ScenarioContext,
  rows: readonly (readonly [string, string])[],
): Promise<WizardOutcome<boolean>> => {
  ctx.ui.note("Summary", rows.map(([k, v]) => `${k.padEnd(11)} ${v}`).join("\n"));
  return ctx.ui.confirm({
    message: "Proceed with install?",
    initial: true,
    allowBack: true,
  });
};

/**
 * Discover installations under `ctx.rootDir`, let the user pick one, then resolve it back
 * to a {@link Target}. Returns `null` if the user cancels or no installations exist.
 *
 * @internal
 */
export const pickInstalledTarget = async (ctx: ScenarioContext): Promise<Target | null> => {
  let list: readonly DiscoveredTarget[];
  try {
    list = await ctx.kit.targets.list({ rootDir: ctx.rootDir });
  } catch (error) {
    ctx.ui.log("error", formatUserError(error));
    return null;
  }
  if (list.length === 0) {
    ctx.ui.log("warn", `No installations under ${ctx.rootDir}. Install one first.`);
    return null;
  }
  const choice = await ctx.ui.select<string>({
    message: "Pick an installation",
    options: list.map((entry) => ({
      label: entry.id,
      value: entry.id,
      hint: entry.minecraftVersions.join(", ") || "no versions",
    })),
    allowCancel: true,
  });
  if (choice.kind !== "ok") return null;
  const entry = list.find((e) => e.id === choice.value);
  if (!entry) return null;
  const mcVersion = await pickMinecraftVersionFromEntry(ctx, entry);
  if (!mcVersion) return null;
  const loaderHint = entry.loaders.find(
    (l) => !l.minecraftVersion || l.minecraftVersion === mcVersion,
  );
  try {
    return await ctx.kit.targets.resolve({
      id: entry.id,
      directory: entry.directory,
      minecraft: { version: mcVersion },
      loader: loaderHintToInput(loaderHint),
    });
  } catch (error) {
    ctx.ui.log("error", formatUserError(error));
    return null;
  }
};

const loaderHintToInput = (
  hint: DiscoveredTarget["loaders"][number] | undefined,
): {
  readonly type: typeof Loaders.VANILLA | typeof Loaders.FABRIC | typeof Loaders.FORGE;
  readonly version?: string;
  readonly preference?: typeof VersionPreference.LATEST | typeof VersionPreference.RECOMMENDED;
} => {
  if (!hint) return { type: Loaders.VANILLA };
  if (hint.type === Loaders.FABRIC) {
    return hint.version
      ? { type: Loaders.FABRIC, version: hint.version }
      : { type: Loaders.FABRIC, preference: VersionPreference.LATEST };
  }
  if (hint.type === Loaders.FORGE) {
    return hint.version
      ? { type: Loaders.FORGE, version: hint.version }
      : { type: Loaders.FORGE, preference: VersionPreference.RECOMMENDED };
  }
  return { type: Loaders.VANILLA };
};
