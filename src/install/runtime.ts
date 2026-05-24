import path from "node:path";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { isJavaRuntimeManifestShape } from "../core/guards";
import { withOptionalSignal } from "../core/optional";
import { targetPaths } from "../core/paths";
import { fetchJson } from "../http/metadata";
import type { MetadataCache } from "../types/cache";
import type { HttpClient } from "../types/http";
import { type DownloadAction, DownloadCategories, InstallActionKinds } from "../types/install";
import type { ResolvedRuntime, RuntimeFilesManifest } from "../types/runtime";

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
  const manifestRaw = await fetchJson<unknown>(input.http, input.cache, {
    url: input.runtime.manifestUrl,
    cacheKey: `runtime-manifest:${input.runtime.component}:${input.runtime.platformKey}:${input.runtime.manifestSha1}`,
    ...withOptionalSignal(input.signal),
  });
  if (!isJavaRuntimeManifestShape(manifestRaw)) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.MANIFEST_INVALID,
      `Java runtime files manifest does not match the expected shape: ${input.runtime.component}`,
      { context: { url: input.runtime.manifestUrl, platform: input.runtime.platformKey } },
    );
  }
  const manifest: RuntimeFilesManifest = manifestRaw;
  const actions: DownloadAction[] = [];
  const runtimeRoot = targetPaths.runtimeRoot(
    input.directory,
    input.runtime.component,
    input.runtime.installRoot,
  );
  for (const [relativePath, entry] of Object.entries(manifest.files)) {
    if (entry.type !== "file") continue;
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
