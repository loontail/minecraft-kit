import { ApiEndpoints } from "../constants/api";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { isMinecraftVersionManifestShape } from "../core/guards";
import { withOptionalSignal } from "../core/optional";
import { fetchJson } from "../http/metadata";
import type {
  MinecraftChannel,
  MinecraftVersionId,
  MinecraftVersionManifest,
  MinecraftVersionSummary,
  ResolvedMinecraft,
} from "../types/minecraft";
import type { ResolverContext } from "./context";

/** Top-level shape returned by `version_manifest_v2.json`. */
type VersionManifestRoot = {
  readonly latest: { readonly release: string; readonly snapshot: string };
  readonly versions: readonly MinecraftVersionSummary[];
};

/**
 * Inputs to {@link MinecraftVersionsApi.list}.
 *
 * @example
 * ```ts
 * import { MinecraftChannels, type MinecraftListInput } from "@loontail/minecraft-kit";
 *
 * const input: MinecraftListInput = { channel: MinecraftChannels.RELEASE };
 * const releases = await kit.versions.minecraft.list(input);
 * ```
 */
export type MinecraftListInput = {
  readonly channel?: MinecraftChannel;
  readonly signal?: AbortSignal;
};

/**
 * Inputs to {@link MinecraftVersionsApi.latest}.
 *
 * @example
 * ```ts
 * import { MinecraftChannels, type MinecraftLatestInput } from "@loontail/minecraft-kit";
 *
 * const input: MinecraftLatestInput = { channel: MinecraftChannels.SNAPSHOT };
 * const latestSnapshot = await kit.versions.minecraft.latest(input);
 * ```
 */
export type MinecraftLatestInput = {
  readonly channel?: MinecraftChannel;
  readonly signal?: AbortSignal;
};

/**
 * Inputs to {@link MinecraftVersionsApi.get} / `.resolve`.
 *
 * @example
 * ```ts
 * import { asMinecraftVersionId, type MinecraftGetInput } from "@loontail/minecraft-kit";
 *
 * const input: MinecraftGetInput = { version: asMinecraftVersionId("1.20.1") };
 * const resolved = await kit.versions.minecraft.resolve(input);
 * console.log(resolved.manifest.id, resolved.manifest.javaVersion?.majorVersion);
 * ```
 */
export type MinecraftGetInput = {
  readonly version: MinecraftVersionId;
  readonly signal?: AbortSignal;
};

/**
 * Public Minecraft versions API surface.
 *
 * Available off a kit instance as `kit.versions.minecraft`.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const latest = await kit.versions.minecraft.latest();
 * const resolved = await kit.versions.minecraft.resolve({ version: latest.id });
 * ```
 */
export class MinecraftVersionsApi {
  constructor(private readonly ctx: ResolverContext) {}

  /** List all Minecraft versions, optionally filtered by channel. */
  async list(input: MinecraftListInput = {}): Promise<readonly MinecraftVersionSummary[]> {
    const root = await this.fetchManifestRoot(input.signal);
    if (input.channel === undefined) return root.versions;
    return root.versions.filter((v) => v.type === input.channel);
  }

  /** Return the latest version on the given channel (defaults to RELEASE). */
  async latest(input: MinecraftLatestInput = {}): Promise<MinecraftVersionSummary> {
    const root = await this.fetchManifestRoot(input.signal);
    const targetId = input.channel === "snapshot" ? root.latest.snapshot : root.latest.release;
    const summary = root.versions.find((v) => v.id === targetId);
    if (!summary) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.MANIFEST_NOT_FOUND,
        `Latest version ${targetId} not found in manifest`,
      );
    }
    return summary;
  }

  /** Return a single version summary or throw `MANIFEST_NOT_FOUND`. */
  async get(input: MinecraftGetInput): Promise<MinecraftVersionSummary> {
    const root = await this.fetchManifestRoot(input.signal);
    const summary = root.versions.find((v) => v.id === input.version);
    if (!summary) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.MANIFEST_NOT_FOUND,
        `Minecraft version not found: ${input.version}`,
        { context: { version: input.version } },
      );
    }
    return summary;
  }

  /** Fetch and parse the per-version manifest in addition to the summary. */
  async resolve(input: MinecraftGetInput): Promise<ResolvedMinecraft> {
    const summary = await this.get(input);
    const raw = await fetchJson<unknown>(this.ctx.http, this.ctx.cache, {
      url: summary.url,
      cacheKey: `minecraft-manifest:${summary.id}:${summary.sha1}`,
      ...withOptionalSignal(input.signal),
    });
    if (!isMinecraftVersionManifestShape(raw)) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.MANIFEST_INVALID,
        `Per-version manifest does not match the expected shape: ${summary.id}`,
        { context: { version: summary.id, url: summary.url } },
      );
    }
    const manifest = raw as unknown as MinecraftVersionManifest;
    return {
      version: summary.id,
      channel: summary.type,
      manifest,
      summary,
    };
  }

  private async fetchManifestRoot(signal: AbortSignal | undefined): Promise<VersionManifestRoot> {
    return fetchJson<VersionManifestRoot>(this.ctx.http, this.ctx.cache, {
      url: ApiEndpoints.mojang.versionManifest(),
      cacheKey: "minecraft-version-manifest-v2",
      ...withOptionalSignal(signal),
    });
  }
}
