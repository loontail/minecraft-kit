import path from "node:path";
import { targetPaths } from "../core/paths";
import { fetchRuntimeManifest } from "../http/manifests";
import type { MetadataCache } from "../types/cache";
import type { HttpClient } from "../types/http";
import { type DownloadAction, DownloadCategories, InstallActionKinds } from "../types/install";
import {
  type ResolvedRuntime,
  RuntimeEntryTypes,
  type RuntimeFilesManifest,
} from "../types/runtime";

/**
 * Plan the per-file downloads required to install a runtime.
 *
 * @internal
 */
export const planRuntimeDownloads = async (input: {
  readonly runtime: ResolvedRuntime;
  readonly directory: string;
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly signal?: AbortSignal;
}): Promise<{
  readonly actions: readonly DownloadAction[];
  readonly manifest: RuntimeFilesManifest;
}> => {
  const manifest = await fetchRuntimeManifest(input.http, input.cache, input.runtime, input.signal);
  const actions: DownloadAction[] = [];
  const runtimeRoot = targetPaths.runtimeRoot(
    input.directory,
    input.runtime.component,
    input.runtime.installRoot,
  );
  for (const [relativePath, entry] of Object.entries(manifest.files)) {
    if (entry.type !== RuntimeEntryTypes.FILE) continue;
    const target = path.join(runtimeRoot, relativePath);
    actions.push({
      kind: InstallActionKinds.DOWNLOAD_FILE,
      url: entry.downloads.raw.url,
      target,
      expectedSha1: entry.downloads.raw.sha1,
      expectedSize: entry.downloads.raw.size,
      category: DownloadCategories.RUNTIME_FILE,
    });
  }
  return { actions, manifest };
};
