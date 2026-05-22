import { asMinecraftVersionId } from "../../../core/version-id";
import {
  type MinecraftChannel,
  MinecraftChannels,
  type MinecraftVersionId,
  type MinecraftVersionSummary,
} from "../../../types/minecraft";
import type { DiscoveredTarget } from "../../../types/target";
import { formatUserError } from "../../error-format";
import type { SelectOption, Ui, WizardOutcome } from "../../ui";
import { CHANNEL_OPTIONS, type ScenarioContext } from "../types";

/**
 * Channel preset picker (release / snapshot / old / all).
 *
 * @internal
 */
export const pickChannel = async (
  ui: Ui,
): Promise<WizardOutcome<MinecraftChannel | "old" | "all">> => {
  return ui.select({
    message: "Select Minecraft channel",
    options: CHANNEL_OPTIONS,
    allowCancel: true,
  });
};

/**
 * Pick a specific Minecraft version, filtered + de-duplicated by channel.
 *
 * @internal
 */
export const pickMinecraftVersion = async (
  ctx: ScenarioContext,
  channel: MinecraftChannel | "old" | "all",
): Promise<WizardOutcome<MinecraftVersionSummary>> => {
  const spinner = ctx.ui.spinner();
  spinner.start("Loading Minecraft versions…");
  let versions: readonly MinecraftVersionSummary[];
  try {
    versions = await ctx.kit.versions.minecraft.list();
    spinner.stop(`${versions.length} versions loaded.`);
  } catch (error) {
    spinner.stop("Failed to load versions.");
    ctx.ui.log("error", formatUserError(error));
    return { kind: "back" };
  }
  const filtered = filterVersionsByChannel(versions, channel);
  if (filtered.length === 0) {
    ctx.ui.log("warn", "No versions in that channel.");
    return { kind: "back" };
  }
  const sorted = dedupeAndSortNewestFirst(filtered);
  const options: SelectOption<MinecraftVersionSummary>[] = sorted.map((v) => ({
    label: v.id,
    value: v,
    hint: `${v.type} · ${(v.releaseTime ?? "").slice(0, 10)}`,
  }));
  return ctx.ui.searchableSelect({
    message: "Select Minecraft version",
    options,
    allowBack: true,
    allowCancel: true,
  });
};

/**
 * Pick a Minecraft version from an already-discovered installation. Skips the picker if
 * the installation only has one version on disk.
 *
 * @internal
 */
export const pickMinecraftVersionFromEntry = async (
  ctx: ScenarioContext,
  entry: DiscoveredTarget,
): Promise<MinecraftVersionId | null> => {
  if (entry.minecraftVersions.length === 0) {
    ctx.ui.log("warn", "Installation has no Minecraft versions on disk.");
    return null;
  }
  const first = entry.minecraftVersions[0];
  if (entry.minecraftVersions.length === 1) {
    return first ? asMinecraftVersionId(first) : null;
  }
  const choice = await ctx.ui.select<string>({
    message: "Multiple Minecraft versions on disk — pick one",
    options: entry.minecraftVersions.map((v) => ({ label: v, value: v })),
    allowCancel: true,
  });
  if (choice.kind !== "ok") return null;
  return asMinecraftVersionId(choice.value);
};

const dedupeAndSortNewestFirst = (
  versions: readonly MinecraftVersionSummary[],
): readonly MinecraftVersionSummary[] => {
  const seen = new Set<string>();
  const unique: MinecraftVersionSummary[] = [];
  for (const v of versions) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    unique.push(v);
  }
  return [...unique].sort((a, b) => (b.releaseTime ?? "").localeCompare(a.releaseTime ?? ""));
};

const filterVersionsByChannel = (
  versions: readonly MinecraftVersionSummary[],
  channel: MinecraftChannel | "old" | "all",
): readonly MinecraftVersionSummary[] => {
  if (channel === "all") return versions;
  if (channel === "old") {
    return versions.filter(
      (v) => v.type === MinecraftChannels.OLD_BETA || v.type === MinecraftChannels.OLD_ALPHA,
    );
  }
  return versions.filter((v) => v.type === channel);
};
