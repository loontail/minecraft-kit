import { fileExists } from "../core/fs";
import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import { targetPaths } from "../core/paths";
import { fetchAssetIndex, uniqueAssetObjects } from "../http/manifests";
import { planLibraryDownloads } from "../install/libraries";
import { DownloadCategories } from "../types/install";
import type { Target } from "../types/target";
import {
  VerificationKinds,
  type VerificationResult,
  type VerifyAspectInput,
  VerifyFileCategories,
  VerifyFileStatuses,
} from "../types/verify";
import {
  recordLibraryDownloads,
  runVerification,
  type VerificationRecorder,
  verifyExistence,
  verifyHashedFile,
  verifyHashedFiles,
} from "./helpers";

/**
 * Verify the vanilla Minecraft slice of an installation: the client jar, version JSON,
 * libraries (incl. native jars), assets (index + objects), logging config, and the
 * extracted natives directory.
 *
 * Prefer `kit.verify.minecraft.run(target)` over importing this directly.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const result = await kit.verify.minecraft.run(target);
 * if (!result.isValid) console.warn(`missing/corrupt: ${result.issues.length} files`);
 * ```
 */
export const verifyMinecraft = async (input: VerifyAspectInput): Promise<VerificationResult> => {
  return runVerification(
    {
      targetId: input.target.id,
      kind: VerificationKinds.MINECRAFT,
      ...withOptionalOnEvent(input.onEvent),
      ...withOptionalSignal(input.signal),
    },
    async (record) => {
      await recordClientJarAndVersionJson(record, input.target);
      await recordLoggingConfig(record, input.target);
      const libraryPlan = await recordLibrariesAndReturnPlan(record, input);
      await recordAssetIndexAndObjects(record, input);
      await recordNativesIssuesWhenDirectoryMissing(record, input.target, libraryPlan);
    },
  );
};

const recordClientJarAndVersionJson = async (
  record: VerificationRecorder,
  target: Target,
): Promise<void> => {
  const { directory, minecraft } = target;
  record(
    await verifyHashedFile({
      path: targetPaths.versionJar(directory, minecraft.version),
      expectedSha1: minecraft.manifest.downloads.client.sha1,
      expectedSize: minecraft.manifest.downloads.client.size,
      url: minecraft.manifest.downloads.client.url,
      category: VerifyFileCategories.CLIENT_JAR,
    }),
  );
  record(
    await verifyExistence({
      path: targetPaths.versionJson(directory, minecraft.version),
      category: VerifyFileCategories.CLIENT_JAR,
    }),
  );
};

const recordLoggingConfig = async (record: VerificationRecorder, target: Target): Promise<void> => {
  const logging = target.minecraft.manifest.logging?.client;
  if (!logging) return;
  record(
    await verifyHashedFile({
      path: targetPaths.loggingConfig(target.directory, logging.file.id),
      expectedSha1: logging.file.sha1,
      expectedSize: logging.file.size,
      url: logging.file.url,
      category: VerifyFileCategories.LOGGING_CONFIG,
    }),
  );
};

const recordLibrariesAndReturnPlan = async (
  record: VerificationRecorder,
  input: VerifyAspectInput,
): Promise<ReturnType<typeof planLibraryDownloads>> => {
  const { target } = input;
  const libraryPlan = planLibraryDownloads({
    libraries: target.minecraft.manifest.libraries,
    directory: target.directory,
    system: target.runtime.system,
    versionId: target.minecraft.version,
    category: DownloadCategories.LIBRARY,
  });
  await recordLibraryDownloads(record, libraryPlan, VerifyFileCategories.LIBRARY, input.signal);
  return libraryPlan;
};

const recordAssetIndexAndObjects = async (
  record: VerificationRecorder,
  input: VerifyAspectInput,
): Promise<void> => {
  const { directory, minecraft } = input.target;
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
  let indexDocument: Awaited<ReturnType<typeof fetchAssetIndex>>;
  try {
    indexDocument = await fetchAssetIndex(
      input.http,
      input.cache,
      minecraft.manifest.assetIndex,
      input.signal,
    );
  } catch {
    recordAssetIndexUnusable(record, indexUrl);
    return;
  }
  await verifyHashedFiles(
    record,
    [...uniqueAssetObjects(indexDocument.objects)].map((entry) => ({
      path: targetPaths.assetObject(directory, entry.hash),
      expectedSha1: entry.hash,
      expectedSize: entry.size,
      category: VerifyFileCategories.ASSET,
    })),
    input.signal,
  );
};

/**
 * Record a single `MISSING` issue keyed on the asset-index URL when the index cannot be
 * read — either it is unreachable (offline / cold cache) or the 200 response is not a valid
 * asset index (captive portal / hijacked mirror). Mirrors
 * {@link recordRuntimeManifestUnreachable}: lets the caller see that assets cannot be
 * verified right now without treating an unenumerable index as proof the assets are valid.
 */
const recordAssetIndexUnusable = (record: VerificationRecorder, indexUrl: string): void => {
  record({
    path: indexUrl,
    category: VerifyFileCategories.ASSET_INDEX,
    status: VerifyFileStatuses.MISSING,
  });
};

/**
 * When the natives directory is gone, every native JAR needs to be re-extracted: emit one
 * `NATIVE` issue per source JAR so the count of issues matches the count of
 * `EXTRACT_NATIVE` actions that repair will produce.
 */
const recordNativesIssuesWhenDirectoryMissing = async (
  record: VerificationRecorder,
  target: Target,
  libraryPlan: ReturnType<typeof planLibraryDownloads>,
): Promise<void> => {
  const nativesDir = targetPaths.nativesDir(target.directory, target.minecraft.version);
  if (await fileExists(nativesDir)) return;
  for (const extraction of libraryPlan.nativeExtractions) {
    record({
      path: extraction.source,
      category: VerifyFileCategories.NATIVE,
      status: VerifyFileStatuses.MISSING,
    });
  }
};
