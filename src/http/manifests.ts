import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { isAssetIndexShape, isJavaRuntimeManifestShape } from "../core/guards";
import { withOptionalSignal } from "../core/optional";
import type { MetadataCache } from "../types/cache";
import type { HttpClient } from "../types/http";
import type { AssetIndexDocument, AssetIndexReference, AssetObject } from "../types/minecraft";
import type { ResolvedRuntime, RuntimeFilesManifest } from "../types/runtime";
import { fetchJson } from "./metadata";

/**
 * Fetch and validate a Mojang asset index. The single source of truth for both the install
 * planner ({@link "../install/assets"}) and the Minecraft verifier ({@link "../verify/minecraft"}):
 * one cache-key format and one shape guard, so the two paths cannot drift.
 *
 * Throws `MANIFEST_INVALID` when the 200 response is not a recognisable asset index
 * (captive portal / hijacked mirror). The install planner lets this propagate; the verifier
 * catches it and records the index as unusable.
 *
 * @internal
 */
export const fetchAssetIndex = async (
  http: HttpClient,
  cache: MetadataCache,
  assetIndex: AssetIndexReference,
  signal?: AbortSignal,
): Promise<AssetIndexDocument> => {
  const raw = await fetchJson<unknown>(http, cache, {
    url: assetIndex.url,
    cacheKey: `asset-index:${assetIndex.id}:${assetIndex.sha1}`,
    ...withOptionalSignal(signal),
  });
  if (!isAssetIndexShape(raw)) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.MANIFEST_INVALID,
      `Asset index does not match the expected shape: ${assetIndex.id}`,
      { context: { url: assetIndex.url } },
    );
  }
  return raw;
};

/**
 * Fetch and validate a per-component Java runtime files manifest. Shared by the runtime
 * install planner ({@link "../install/runtime"}) and the runtime verifier
 * ({@link "../verify/runtime"}) so the cache-key format and the shape guard stay in lockstep.
 *
 * Throws `MANIFEST_INVALID` when the response is not a recognisable runtime manifest. The
 * install planner lets this propagate; the verifier catches it and records the manifest as
 * unreachable.
 *
 * @internal
 */
export const fetchRuntimeManifest = async (
  http: HttpClient,
  cache: MetadataCache,
  runtime: Pick<ResolvedRuntime, "component" | "platformKey" | "manifestSha1" | "manifestUrl">,
  signal?: AbortSignal,
): Promise<RuntimeFilesManifest> => {
  const raw = await fetchJson<unknown>(http, cache, {
    url: runtime.manifestUrl,
    cacheKey: `runtime-manifest:${runtime.component}:${runtime.platformKey}:${runtime.manifestSha1}`,
    ...withOptionalSignal(signal),
  });
  if (!isJavaRuntimeManifestShape(raw)) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.MANIFEST_INVALID,
      `Java runtime files manifest does not match the expected shape: ${runtime.component}`,
      { context: { url: runtime.manifestUrl, platform: runtime.platformKey } },
    );
  }
  return raw;
};

/**
 * Yield one entry per unique asset hash from an asset index.
 *
 * Asset indexes routinely list the same hash under multiple virtual paths (e.g. legacy
 * localized variants of the same byte content). Emitting one entry per unique hash keeps two
 * parallel writes from racing the same `assets/objects/<hash>` target — a race that surfaces
 * during repair as a "Failed to finalize download" error — and keeps the verifier from
 * hashing the same object twice.
 *
 * @internal
 */
export function* uniqueAssetObjects(
  objects: AssetIndexDocument["objects"],
): Generator<AssetObject> {
  const seen = new Set<string>();
  for (const entry of Object.values(objects)) {
    if (seen.has(entry.hash)) continue;
    seen.add(entry.hash);
    yield entry;
  }
}
