import { ApiEndpoints } from "../constants/api";
import { targetPaths } from "../core/paths";
import { fetchAssetIndex, uniqueAssetObjects } from "../http/manifests";
import type { MetadataCache } from "../types/cache";
import type { HttpClient } from "../types/http";
import { type DownloadAction, DownloadCategories, InstallActionKinds } from "../types/install";
import type { AssetIndexDocument, AssetIndexReference } from "../types/minecraft";

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
  const indexDocument = await fetchAssetIndex(
    input.http,
    input.cache,
    input.assetIndex,
    input.signal,
  );
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
  for (const entry of uniqueAssetObjects(indexDocument.objects)) {
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
