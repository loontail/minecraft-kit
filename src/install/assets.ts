import { ApiEndpoints } from "../constants/api";
import { targetPaths } from "../core/paths";
import { fetchJson } from "../http/metadata";
import type { MetadataCache } from "../types/cache";
import type { HttpClient } from "../types/http";
import { type DownloadAction, DownloadCategories, InstallActionKinds } from "../types/install";
import type { AssetIndexDocument, AssetIndexReference, AssetObject } from "../types/minecraft";

/**
 * Plan asset downloads: fetch the asset index and emit a download action per object plus the
 * index file itself.
 *
 * @internal
 */
export const planAssetDownloads = async (input: {
  readonly directory: string;
  readonly assetIndex: AssetIndexReference;
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly signal?: AbortSignal;
}): Promise<{
  readonly actions: readonly DownloadAction[];
  readonly indexDocument: AssetIndexDocument;
}> => {
  const indexUrl = input.assetIndex.url;
  const indexPath = targetPaths.assetIndex(input.directory, input.assetIndex.id);
  const indexDocument = await fetchJson<AssetIndexDocument>(input.http, input.cache, {
    url: indexUrl,
    cacheKey: `asset-index:${input.assetIndex.id}:${input.assetIndex.sha1}`,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  });
  const actions: DownloadAction[] = [
    {
      kind: InstallActionKinds.DOWNLOAD_FILE,
      url: indexUrl,
      target: indexPath,
      expectedSha1: input.assetIndex.sha1,
      expectedSize: input.assetIndex.size,
      category: DownloadCategories.ASSET_INDEX,
    },
  ];
  for (const entry of uniqueObjectsByHash(indexDocument.objects)) {
    actions.push({
      kind: InstallActionKinds.DOWNLOAD_FILE,
      url: ApiEndpoints.resources.asset(entry.hash),
      target: targetPaths.assetObject(input.directory, entry.hash),
      expectedSha1: entry.hash,
      expectedSize: entry.size,
      category: DownloadCategories.ASSET,
    });
  }
  return { actions, indexDocument };
};

/**
 * Yield one entry per unique asset hash from the asset index.
 *
 * Asset indexes routinely list the same hash under multiple virtual paths (e.g. legacy
 * localized variants of the same byte content). Emitting one `DOWNLOAD_FILE` per unique
 * hash keeps two parallel writes from racing the same `assets/objects/<hash>` target — a
 * race that surfaces during repair as a "Failed to finalize download" error.
 */
function* uniqueObjectsByHash(objects: AssetIndexDocument["objects"]): Generator<AssetObject> {
  const seen = new Set<string>();
  for (const entry of Object.values(objects)) {
    if (seen.has(entry.hash)) continue;
    seen.add(entry.hash);
    yield entry;
  }
}
