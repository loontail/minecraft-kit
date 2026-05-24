import { ApiEndpoints } from "../constants/api";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { isFabricProfileShape } from "../core/guards";
import { withOptionalSignal } from "../core/optional";
import { asMinecraftVersionId } from "../core/version-id";
import { fetchJson } from "../http/metadata";
import type { OperationOptions } from "../types/events";
import type {
  FabricCompatibilityEntry,
  FabricLoaderSummary,
  ResolvedFabricLoader,
} from "../types/fabric";
import { Loaders, VersionPreference, type VersionPreferenceKind } from "../types/loader";
import type { MinecraftVersionId } from "../types/minecraft";
import type { ResolverContext } from "./context";

/**
 * Inputs to {@link FabricVersionsApi.list}.
 *
 * @example
 * ```ts
 * import type { FabricListInput } from "@loontail/minecraft-kit";
 *
 * const input: FabricListInput = { minecraftVersion: "1.20.1" };
 * const loaders = await kit.versions.fabric.list(input);
 * ```
 */
export type FabricListInput = {
  readonly minecraftVersion?: string;
  readonly signal?: AbortSignal;
};

/**
 * Inputs to {@link FabricVersionsApi.resolve}.
 *
 * @example
 * ```ts
 * import { VersionPreference, type FabricResolveInput } from "@loontail/minecraft-kit";
 *
 * const input: FabricResolveInput = {
 *   minecraftVersion: "1.20.1",
 *   preference: VersionPreference.RECOMMENDED,
 * };
 * const fabric = await kit.versions.fabric.resolve(input);
 * ```
 */
export type FabricResolveInput = {
  readonly minecraftVersion: string;
  readonly preference?: VersionPreferenceKind;
  readonly loaderVersion?: string;
  readonly signal?: AbortSignal;
};

/**
 * One entry from the upstream Fabric `gameVersions` listing — the set of
 * Minecraft versions Fabric supports at all, independent of any specific
 * loader version.
 *
 * @example
 * ```ts
 * import type { FabricGameVersionEntry } from "@loontail/minecraft-kit";
 *
 * const games: readonly FabricGameVersionEntry[] = await kit.versions.fabric.gameVersions();
 * const stable = games.filter((g) => g.stable).map((g) => g.version);
 * ```
 */
export type FabricGameVersionEntry = {
  readonly version: MinecraftVersionId;
  readonly stable: boolean;
};

/**
 * Inputs to {@link FabricVersionsApi.gameVersions}.
 *
 * @example
 * ```ts
 * import type { FabricGameVersionsInput } from "@loontail/minecraft-kit";
 *
 * const controller = new AbortController();
 * const input: FabricGameVersionsInput = { signal: controller.signal };
 * const games = await kit.versions.fabric.gameVersions(input);
 * ```
 */
export type FabricGameVersionsInput = OperationOptions;

/** Raw shape of one entry returned by `meta.fabricmc.net/v2/versions/game`. */
type FabricGameVersionRaw = {
  readonly version: string;
  readonly stable: boolean;
};

/**
 * Public Fabric versions API surface.
 *
 * Available off a kit instance as `kit.versions.fabric`; construct manually only when
 * wiring a custom context.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const fabric = await kit.versions.fabric.resolve({ minecraftVersion: "1.20.1" });
 * console.log(fabric.loaderVersion, fabric.profile.id);
 * ```
 */
export class FabricVersionsApi {
  constructor(private readonly ctx: ResolverContext) {}

  /**
   * List the Minecraft versions Fabric supports at all, independent of any
   * specific loader. Each entry carries the upstream `stable` flag.
   */
  async gameVersions(
    input: FabricGameVersionsInput = {},
  ): Promise<readonly FabricGameVersionEntry[]> {
    const raw = await fetchJson<readonly FabricGameVersionRaw[]>(this.ctx.http, this.ctx.cache, {
      url: ApiEndpoints.fabric.gameVersions(),
      cacheKey: "fabric:game-versions:v1",
      ...withOptionalSignal(input.signal),
    });
    return raw.map(
      (entry): FabricGameVersionEntry => ({
        version: asMinecraftVersionId(entry.version),
        stable: entry.stable,
      }),
    );
  }

  /** List Fabric loader versions, optionally constrained to a Minecraft version. */
  async list(input: FabricListInput = {}): Promise<readonly FabricLoaderSummary[]> {
    if (input.minecraftVersion === undefined) {
      return fetchJson<readonly FabricLoaderSummary[]>(this.ctx.http, this.ctx.cache, {
        url: ApiEndpoints.fabric.loaderVersions(),
        cacheKey: "fabric-loader-all",
        ...withOptionalSignal(input.signal),
      });
    }
    const compat = await fetchJson<readonly FabricCompatibilityEntry[]>(
      this.ctx.http,
      this.ctx.cache,
      {
        url: ApiEndpoints.fabric.loaderForGame(input.minecraftVersion),
        cacheKey: `fabric-loader-mc:${input.minecraftVersion}`,
        ...withOptionalSignal(input.signal),
      },
    );
    return compat.map((c) => c.loader);
  }

  /** Resolve a Fabric loader version against a Minecraft version. */
  async resolve(input: FabricResolveInput): Promise<ResolvedFabricLoader> {
    const loaders = await this.list({
      minecraftVersion: input.minecraftVersion,
      ...withOptionalSignal(input.signal),
    });
    if (loaders.length === 0) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.MANIFEST_NOT_FOUND,
        `No Fabric loader available for Minecraft ${input.minecraftVersion}`,
        { context: { version: input.minecraftVersion } },
      );
    }
    const chosen = pickFabricLoader(loaders, input);
    if (!chosen) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.MANIFEST_NOT_FOUND,
        `Fabric loader version not found: ${input.loaderVersion ?? "(none matched)"}`,
        {
          context: input.loaderVersion !== undefined ? { version: input.loaderVersion } : {},
        },
      );
    }
    const profileUrl = ApiEndpoints.fabric.profile(input.minecraftVersion, chosen.version);
    const profileRaw = await fetchJson<unknown>(this.ctx.http, this.ctx.cache, {
      url: profileUrl,
      cacheKey: `fabric-profile:${input.minecraftVersion}:${chosen.version}`,
      ...withOptionalSignal(input.signal),
    });
    if (!isFabricProfileShape(profileRaw)) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.MANIFEST_INVALID,
        `Fabric profile does not match the expected shape: ${input.minecraftVersion}/${chosen.version}`,
        { context: { url: profileUrl, version: input.minecraftVersion } },
      );
    }
    return {
      type: Loaders.FABRIC,
      minecraftVersion: input.minecraftVersion,
      loaderVersion: chosen.version,
      profile: profileRaw,
    };
  }
}

const pickFabricLoader = (
  loaders: readonly FabricLoaderSummary[],
  input: FabricResolveInput,
): FabricLoaderSummary | undefined => {
  if (input.loaderVersion !== undefined) {
    return loaders.find((l) => l.version === input.loaderVersion);
  }
  const preference = input.preference ?? VersionPreference.LATEST;
  if (preference === VersionPreference.RECOMMENDED) {
    const stable = loaders.find((l) => l.stable);
    if (stable) return stable;
  }
  return loaders[0];
};
