import { ApiEndpoints } from "../constants/api";
import { RUNTIME_PLATFORM_KEYS } from "../constants/platform";
import { FALLBACK_COMPONENT } from "../constants/runtime";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { isMojangJavaRuntimesShape } from "../core/guards";
import { withOptionalSignal } from "../core/optional";
import { fetchJson } from "../http/metadata";
import type { ResolvedRuntime, RuntimeIndex, RuntimeIndexEntry } from "../types/runtime";
import { RuntimePreference, type RuntimePreferenceKind } from "../types/runtime";
import type { RuntimeSystem } from "../types/system";
import type { ResolverContext } from "./context";

/**
 * Inputs to {@link RuntimeVersionsApi.list}.
 *
 * @example
 * ```ts
 * import { detectSystem, type RuntimeListInput } from "@loontail/minecraft-kit";
 *
 * const input: RuntimeListInput = { system: detectSystem() };
 * const runtimes = await kit.versions.runtime.list(input);
 * ```
 */
export type RuntimeListInput = {
  readonly system: RuntimeSystem;
  readonly minecraftVersion?: string;
  readonly signal?: AbortSignal;
};

/**
 * A summary entry for the list API.
 *
 * @example
 * ```ts
 * import type { RuntimeListEntry } from "@loontail/minecraft-kit";
 *
 * const entries: readonly RuntimeListEntry[] = await kit.versions.runtime.list({ system });
 * for (const e of entries) console.log(e.component, e.versionName, e.released);
 * ```
 */
export type RuntimeListEntry = {
  readonly component: string;
  readonly platformKey: string;
  readonly versionName: string;
  readonly released: string;
  readonly manifestUrl: string;
};

/**
 * Inputs to {@link RuntimeVersionsApi.resolve}.
 *
 * @example
 * ```ts
 * import { detectSystem, RuntimeComponents, type RuntimeResolveInput } from "@loontail/minecraft-kit";
 *
 * const input: RuntimeResolveInput = {
 *   system: detectSystem(),
 *   component: RuntimeComponents.JAVA_RUNTIME_GAMMA,
 * };
 * const runtime = await kit.versions.runtime.resolve(input);
 * ```
 */
export type RuntimeResolveInput = {
  readonly system: RuntimeSystem;
  readonly minecraftVersion?: string;
  readonly component?: string;
  readonly preference?: RuntimePreferenceKind;
  readonly signal?: AbortSignal;
};

/**
 * Public runtime versions API surface.
 *
 * Available off a kit instance as `kit.versions.runtime`.
 *
 * @example
 * ```ts
 * import { detectSystem, MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const runtime = await kit.versions.runtime.resolve({ system: detectSystem() });
 * console.log(runtime.component, runtime.versionName);
 * ```
 */
export class RuntimeVersionsApi {
  constructor(private readonly ctx: ResolverContext) {}

  /** List available runtime entries for the host platform. */
  async list(input: RuntimeListInput): Promise<readonly RuntimeListEntry[]> {
    const platformKey = pickPlatformKey(input.system);
    const index = await this.fetchIndex(input.signal);
    const platform = index[platformKey];
    if (!platform) return [];
    const entries: RuntimeListEntry[] = [];
    for (const [component, items] of Object.entries(platform)) {
      for (const item of items) {
        entries.push({
          component,
          platformKey,
          versionName: item.version.name,
          released: item.version.released,
          manifestUrl: item.manifest.url,
        });
      }
    }
    return entries;
  }

  /** Resolve a single runtime for the host platform and Minecraft version. */
  async resolve(input: RuntimeResolveInput): Promise<ResolvedRuntime> {
    const platformKey = pickPlatformKey(input.system);
    const index = await this.fetchIndex(input.signal);
    const platform = index[platformKey];
    if (!platform) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.RUNTIME_UNSUPPORTED_PLATFORM,
        `No runtimes published for platform: ${platformKey}`,
        { context: { platform: platformKey } },
      );
    }
    const component = input.component ?? FALLBACK_COMPONENT;
    const candidates = platform[component] ?? [];
    if (candidates.length === 0) {
      const all = Object.entries(platform);
      const preference = input.preference ?? RuntimePreference.RECOMMENDED;
      if (preference === RuntimePreference.LATEST) {
        const fallback = pickLatestAcrossComponents(all);
        if (fallback) {
          return toResolved(fallback.component, platformKey, fallback.entry, input.system);
        }
      }
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.RUNTIME_NOT_FOUND,
        `Runtime component ${component} not available on ${platformKey}`,
        { context: { platform: platformKey, version: component } },
      );
    }
    const entry = candidates[0];
    if (!entry) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.RUNTIME_NOT_FOUND,
        `Runtime component ${component} list is empty for ${platformKey}`,
        { context: { platform: platformKey, version: component } },
      );
    }
    return toResolved(component, platformKey, entry, input.system);
  }

  private async fetchIndex(signal: AbortSignal | undefined): Promise<RuntimeIndex> {
    const url = ApiEndpoints.mojang.runtimeIndex();
    const raw = await fetchJson<unknown>(this.ctx.http, this.ctx.cache, {
      url,
      cacheKey: "mojang-runtime-index",
      ...withOptionalSignal(signal),
    });
    if (!isMojangJavaRuntimesShape(raw)) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.MANIFEST_INVALID,
        "Mojang Java runtimes index does not match the expected shape",
        { context: { url } },
      );
    }
    return raw;
  }
}

const pickPlatformKey = (system: RuntimeSystem): string => {
  const archMap = RUNTIME_PLATFORM_KEYS[system.os];
  return archMap[system.arch];
};

const pickLatestAcrossComponents = (
  entries: readonly [string, readonly RuntimeIndexEntry[]][],
): { readonly component: string; readonly entry: RuntimeIndexEntry } | null => {
  let bestComponent: string | null = null;
  let bestEntry: RuntimeIndexEntry | null = null;
  for (const [component, list] of entries) {
    for (const entry of list) {
      if (!bestEntry || entry.version.released > bestEntry.version.released) {
        bestComponent = component;
        bestEntry = entry;
      }
    }
  }
  if (!bestComponent || !bestEntry) return null;
  return { component: bestComponent, entry: bestEntry };
};

const toResolved = (
  component: string,
  platformKey: string,
  entry: RuntimeIndexEntry,
  system: RuntimeSystem,
): ResolvedRuntime => {
  const majorVersion = parseMajorVersion(entry.version.name);
  return {
    component,
    platformKey,
    versionName: entry.version.name,
    ...(majorVersion !== undefined ? { majorVersion } : {}),
    system,
    manifestUrl: entry.manifest.url,
    manifestSha1: entry.manifest.sha1,
  };
};

/**
 * Parse the leading integer from a runtime versionName (`"21.0.8"` → 21).
 *
 * @internal
 */
export const parseMajorVersion = (versionName: string): number | undefined => {
  const match = /^(\d+)/.exec(versionName);
  if (!match?.[1]) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};
