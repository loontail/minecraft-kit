import { ApiEndpoints } from "../constants/api";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { parseMavenMetadataVersions } from "../core/xml";
import { fetchJson, fetchText } from "../http/metadata";
import type { ForgeBuildSummary, ResolvedForgeLoader } from "../types/forge";
import { Loaders, VersionPreference, type VersionPreferenceKind } from "../types/loader";
import type { ResolverContext } from "./context";

/**
 * Inputs to {@link ForgeVersionsApi.list}.
 *
 * @example
 * ```ts
 * import type { ForgeListInput } from "@loontail/minecraft-kit";
 *
 * const input: ForgeListInput = { minecraftVersion: "1.20.1" };
 * const builds = await kit.versions.forge.list(input);
 * ```
 */
export type ForgeListInput = {
  readonly minecraftVersion?: string;
  readonly signal?: AbortSignal;
};

/**
 * Inputs to {@link ForgeVersionsApi.resolve}.
 *
 * @example
 * ```ts
 * import { VersionPreference, type ForgeResolveInput } from "@loontail/minecraft-kit";
 *
 * const input: ForgeResolveInput = {
 *   minecraftVersion: "1.20.1",
 *   preference: VersionPreference.RECOMMENDED,
 * };
 * const forge = await kit.versions.forge.resolve(input);
 * ```
 */
export type ForgeResolveInput = {
  readonly minecraftVersion: string;
  readonly preference?: VersionPreferenceKind;
  readonly forgeVersion?: string;
  readonly signal?: AbortSignal;
};

/**
 * Public Forge versions API surface.
 *
 * Available off a kit instance as `kit.versions.forge`.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const forge = await kit.versions.forge.resolve({ minecraftVersion: "1.20.1" });
 * console.log(forge.fullVersion, forge.installerUrl);
 * ```
 */
export class ForgeVersionsApi {
  constructor(private readonly ctx: ResolverContext) {}

  /** List Forge builds (across all Minecraft versions, or filtered to one). */
  async list(input: ForgeListInput = {}): Promise<readonly ForgeBuildSummary[]> {
    const xml = await fetchText(this.ctx.http, this.ctx.cache, {
      url: ApiEndpoints.forge.mavenMetadata(),
      cacheKey: "forge-maven-metadata",
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    });
    const allVersions = parseMavenMetadataVersions(xml);
    const promotions = await fetchJson<ForgePromotions>(this.ctx.http, this.ctx.cache, {
      url: ApiEndpoints.forge.promotions(),
      cacheKey: "forge-promotions",
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    });
    const summaries = allVersions
      .map((fullVersion) => buildSummary(fullVersion, promotions))
      .filter((s): s is ForgeBuildSummary => s !== null);
    if (input.minecraftVersion === undefined) return summaries;
    return summaries.filter((s) => s.minecraftVersion === input.minecraftVersion);
  }

  /** Resolve a Forge build for a Minecraft version. */
  async resolve(input: ForgeResolveInput): Promise<ResolvedForgeLoader> {
    const builds = await this.list({
      minecraftVersion: input.minecraftVersion,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    });
    if (builds.length === 0) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.MANIFEST_NOT_FOUND,
        `No Forge build available for Minecraft ${input.minecraftVersion}`,
        { context: { version: input.minecraftVersion } },
      );
    }
    const chosen = pickForge(builds, input);
    if (!chosen) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.MANIFEST_NOT_FOUND,
        `Forge build not found for ${input.minecraftVersion}: ${input.forgeVersion ?? "(none matched)"}`,
        {
          context: input.forgeVersion !== undefined ? { version: input.forgeVersion } : {},
        },
      );
    }
    return {
      type: Loaders.FORGE,
      minecraftVersion: chosen.minecraftVersion,
      forgeVersion: chosen.forgeVersion,
      fullVersion: chosen.fullVersion,
      installerUrl: ApiEndpoints.forge.installer(chosen.fullVersion),
    };
  }
}

type ForgePromotions = {
  readonly promos: Readonly<Record<string, string>>;
};

const buildSummary = (
  fullVersion: string,
  promotions: ForgePromotions,
): ForgeBuildSummary | null => {
  const dashIndex = fullVersion.indexOf("-");
  if (dashIndex <= 0 || dashIndex === fullVersion.length - 1) return null;
  const minecraftVersion = fullVersion.slice(0, dashIndex);
  const forgeVersion = fullVersion.slice(dashIndex + 1);
  const promos = promotions.promos;
  const recommended = promos[`${minecraftVersion}-recommended`];
  const latest = promos[`${minecraftVersion}-latest`];
  return {
    fullVersion,
    minecraftVersion,
    forgeVersion,
    isRecommended: recommended === forgeVersion,
    isLatest: latest === forgeVersion,
  };
};

const pickForge = (
  builds: readonly ForgeBuildSummary[],
  input: ForgeResolveInput,
): ForgeBuildSummary | undefined => {
  if (input.forgeVersion !== undefined) {
    return builds.find(
      (b) => b.forgeVersion === input.forgeVersion || b.fullVersion === input.forgeVersion,
    );
  }
  const preference = input.preference ?? VersionPreference.RECOMMENDED;
  if (preference === VersionPreference.RECOMMENDED) {
    const recommended = builds.find((b) => b.isRecommended);
    if (recommended) return recommended;
  }
  const latest = builds.find((b) => b.isLatest);
  if (latest) return latest;
  return builds[builds.length - 1];
};
