import { fileExists } from "../core/fs";
import { targetPaths } from "../core/paths";
import { fetchJson } from "../http/metadata";
import { planLibraryDownloads } from "../install/libraries";
import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import type { HttpClient } from "../types/http";
import { DownloadCategories } from "../types/install";
import type { AssetIndexDocument } from "../types/minecraft";
import type { Target } from "../types/target";
import {
  VerificationKinds,
  type VerificationResult,
  VerifyFileCategories,
  VerifyFileStatuses,
} from "../types/verify";
import { runVerification, verifyExistence, verifyHashedFile } from "./helpers";

/**
 * Inputs to {@link verifyMinecraft}.
 *
 * @internal
 */
export type VerifyMinecraftInput = {
  readonly target: Target;
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly signal?: AbortSignal;
  readonly onEvent?: ProgressListener;
};

/**
 * Verify the vanilla Minecraft slice of an installation: the client jar, version JSON,
 * libraries (incl. native jars), assets (index + objects), logging config, and the
 * extracted natives directory.
 */
export const verifyMinecraft = async (input: VerifyMinecraftInput): Promise<VerificationResult> => {
  return runVerification(
    {
      targetId: input.target.id,
      kind: VerificationKinds.MINECRAFT,
      ...(input.onEvent !== undefined ? { onEvent: input.onEvent } : {}),
    },
    async (record) => {
      const { directory, minecraft, runtime } = input.target;

      // Client jar.
      record(
        await verifyHashedFile({
          path: targetPaths.versionJar(directory, minecraft.version),
          expectedSha1: minecraft.manifest.downloads.client.sha1,
          expectedSize: minecraft.manifest.downloads.client.size,
          url: minecraft.manifest.downloads.client.url,
          category: VerifyFileCategories.CLIENT_JAR,
        }),
      );

      // Vanilla version JSON (a missing JSON triggers WRITE_VERSION_JSON during repair).
      record(
        await verifyExistence({
          path: targetPaths.versionJson(directory, minecraft.version),
          category: VerifyFileCategories.CLIENT_JAR,
        }),
      );

      // Logging config.
      if (minecraft.manifest.logging?.client) {
        const logging = minecraft.manifest.logging.client;
        record(
          await verifyHashedFile({
            path: targetPaths.loggingConfig(directory, logging.file.id),
            expectedSha1: logging.file.sha1,
            expectedSize: logging.file.size,
            url: logging.file.url,
            category: VerifyFileCategories.LOGGING_CONFIG,
          }),
        );
      }

      // Libraries (incl. native jars).
      const libraryPlan = planLibraryDownloads({
        libraries: minecraft.manifest.libraries,
        directory,
        system: runtime.system,
        versionId: minecraft.version,
        category: DownloadCategories.LIBRARY,
      });
      for (const action of libraryPlan.downloads) {
        record(
          await verifyHashedFile({
            path: action.target,
            ...(action.expectedSha1 !== undefined ? { expectedSha1: action.expectedSha1 } : {}),
            ...(action.expectedSize !== undefined ? { expectedSize: action.expectedSize } : {}),
            url: action.url,
            category: VerifyFileCategories.LIBRARY,
          }),
        );
      }

      // Asset index + objects.
      const indexUrl = minecraft.manifest.assetIndex.url;
      const indexPath = targetPaths.assetIndex(directory, minecraft.manifest.assetIndex.id);
      record(
        await verifyHashedFile({
          path: indexPath,
          expectedSha1: minecraft.manifest.assetIndex.sha1,
          expectedSize: minecraft.manifest.assetIndex.size,
          url: indexUrl,
          category: VerifyFileCategories.ASSET_INDEX,
        }),
      );
      const indexDocument = await fetchJson<AssetIndexDocument>(input.http, input.cache, {
        url: indexUrl,
        cacheKey: `asset-index:${minecraft.manifest.assetIndex.id}:${minecraft.manifest.assetIndex.sha1}`,
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      });
      // Same hash may be referenced by multiple virtual paths; verify each physical file
      // at most once.
      const seenAssetHashes = new Set<string>();
      for (const entry of Object.values(indexDocument.objects)) {
        if (seenAssetHashes.has(entry.hash)) continue;
        seenAssetHashes.add(entry.hash);
        record(
          await verifyHashedFile({
            path: targetPaths.assetObject(directory, entry.hash),
            expectedSha1: entry.hash,
            expectedSize: entry.size,
            category: VerifyFileCategories.ASSET,
          }),
        );
      }

      // Natives directory presence. When it's gone, every native JAR needs to be
      // re-extracted: emit one NATIVE issue per source JAR so the count of issues matches
      // the count of EXTRACT_NATIVE actions repair will produce.
      const nativesDir = targetPaths.nativesDir(directory, minecraft.version);
      if (!(await fileExists(nativesDir))) {
        for (const extraction of libraryPlan.nativeExtractions) {
          record({
            path: extraction.source,
            category: VerifyFileCategories.NATIVE,
            status: VerifyFileStatuses.MISSING,
          });
        }
      }
    },
  );
};
