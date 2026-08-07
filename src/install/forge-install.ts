/**
 * Forge install orchestrator. Materialises the installer JAR on disk (needed to read
 * `install_profile.json` before the rest of the plan can be produced - see
 * `docs/ai-context.md`), reads the installer's metadata via
 * {@link "./forge-installer-archive"}, plans the per-library actions plus modern processor
 * actions via {@link "./forge-processor-plan"}, and assembles the resulting
 * {@link ForgeInstallPlan}.
 *
 * @internal
 * @packageDocumentation
 */

import fs from "node:fs/promises";
import path from "node:path";
import { dedupe, dedupeBy } from "../core/collections";
import { isMinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { atomicWrite, fileExists, readText } from "../core/fs";
import { mavenRelativePathFor } from "../core/maven";
import {
  withOptionalHostAllowList,
  withOptionalOnEvent,
  withOptionalSignal,
} from "../core/optional";
import { targetPaths } from "../core/paths";
import { downloadFile } from "../http/download";
import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import type {
  ForgeInstallerProfile,
  ForgeInstallProfile,
  ForgeVersionJson,
  LegacyForgeInstallProfile,
  ResolvedForgeLoader,
} from "../types/forge";
import type { HttpClient } from "../types/http";
import {
  type DownloadAction,
  DownloadCategories,
  InstallActionKinds,
  type RunForgeProcessorAction,
  type WriteVersionJsonAction,
} from "../types/install";
import type { ResolvedMinecraft } from "../types/minecraft";
import type { RuntimeSystem } from "../types/system";
import {
  extractInstallerMavenEntries,
  extractLegacyForgeUniversalJar,
  isForgeInstallerProfileShape,
  isForgeVersionJsonShape,
  isLegacyForgeInstallProfileShape,
  readJsonEntry,
} from "./forge-installer-archive";
import {
  buildProcessorActions,
  type ResolvedProfileData,
  resolveProfileData,
} from "./forge-processor-plan";
import { planLibraryDownloads } from "./libraries";

export type { ForgeDataValueDecoded } from "./forge-data-value";
export { decodeForgeDataValue, stripLiteralPrefix } from "./forge-data-value";

/**
 * Outputs of {@link planForgeInstall}.
 *
 * @internal
 */
export type ForgeInstallPlan = {
  readonly libraryDownloads: readonly DownloadAction[];
  readonly classpathFiles: readonly string[];
  readonly processorActions: readonly RunForgeProcessorAction[];
  readonly versionJson: WriteVersionJsonAction;
  readonly versionId: string;
  readonly profile: ForgeInstallerProfile;
  readonly version: ForgeVersionJson;
};

/**
 * Inputs to {@link planForgeInstall}.
 *
 * @internal
 */
export type PlanForgeInstallInput = {
  readonly loader: ResolvedForgeLoader;
  readonly minecraft: ResolvedMinecraft;
  readonly directory: string;
  readonly system: RuntimeSystem;
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly signal?: AbortSignal;
  readonly onEvent?: ProgressListener;
  /**
   * Host allow-list applied to the installer-JAR download, including the post-redirect
   * re-check. Planning is the only stage that downloads before the install runner exists,
   * so without this the installer JAR would be the one download in the kit that a 30x could
   * redirect to an arbitrary host.
   */
  readonly hostAllowList?: readonly string[];
};

/**
 * Plan the Forge install steps. Materialises the installer, parses modern or legacy
 * `install_profile.json`, extracts embedded artifacts to `libraries/`, and prepares
 * processor invocations when the profile declares processors.
 *
 * Unlike the vanilla/Fabric planners this is **not** side-effect-free: it may hit the network
 * (installer download) and writes to disk (`libraries/` extraction). The actions it returns
 * cannot be enumerated without first reading `install_profile.json` out of the installer
 * JAR, so the download + extract are intrinsic to planning rather than deferrable to run.
 *
 * Both side effects are idempotent across repeated calls: an installer already on disk that
 * still parses is reused, and the `maven/` flush is guarded by a sentinel that records what it
 * produced.
 *
 * Neither cache can wedge the install. A JAR that fails anywhere in the archive-reading phase —
 * not just on `install_profile.json` — is discarded and re-fetched once (see
 * {@link isReusableInstallerFailure}), and the sentinel only counts as a hit while every path it
 * recorded is still on disk.
 *
 * @internal
 */
export const planForgeInstall = async (input: PlanForgeInstallInput): Promise<ForgeInstallPlan> => {
  const installerPath = targetPaths.forgeInstaller(input.directory, input.loader.fullVersion);
  const read = await readInstallerArtifactsWithRetry(input, installerPath);
  if (read.kind === "legacy") return read.plan;
  return assembleModernForgePlan({ input, installerPath, ...read });
};

/**
 * Everything {@link planForgeInstall} has to get out of the installer archive. A legacy 1.7.x
 * profile has no processors and nothing to plan past the extraction, so its whole plan is produced
 * here.
 */
type ForgeInstallerRead =
  | { readonly kind: "legacy"; readonly plan: ForgeInstallPlan }
  | {
      readonly kind: "modern";
      readonly profile: ForgeInstallProfile;
      readonly version: ForgeVersionJson;
      readonly dataResolved: ResolvedProfileData;
    };

/**
 * Run the archive-reading phase, discarding the cached installer and re-fetching once if it turns
 * out to be untrustworthy.
 *
 * why: the reuse gate can only see `install_profile.json`, so a JAR that is corrupt *past* that
 * entry — a bad `maven/` member, an unreadable `version.json` — would otherwise fail identically
 * on every future plan, repair, and repair-from-error, with the unlink branch unreachable because
 * the profile still parsed. `reuseInstaller: false` both forces the re-download and rules out a loop:
 * there is exactly one retry, and only for {@link isReusableInstallerFailure} codes. The retry
 * deliberately wraps just this phase — a plan that fails later (an unknown processor token, a bad
 * library coordinate) is a manifest problem no fresh copy of the same JAR can fix.
 */
const readInstallerArtifactsWithRetry = async (
  input: PlanForgeInstallInput,
  installerPath: string,
): Promise<ForgeInstallerRead> => {
  try {
    return await readInstallerArtifacts(input, installerPath, true);
  } catch (error) {
    if (!isReusableInstallerFailure(error)) throw error;
    return await readInstallerArtifacts(input, installerPath, false);
  }
};

const readInstallerArtifacts = async (
  input: PlanForgeInstallInput,
  installerPath: string,
  reuseInstaller: boolean,
): Promise<ForgeInstallerRead> => {
  const profile = await ensureInstallerOnDisk(installerPath, input, reuseInstaller);
  if (isLegacyForgeInstallProfileShape(profile)) {
    return {
      kind: "legacy",
      plan: await planLegacyForgeInstall({ input, installerPath, profile }),
    };
  }

  const versionRelative = profile.json.startsWith("/") ? profile.json.slice(1) : profile.json;
  const version = await readJsonEntry<ForgeVersionJson>(
    installerPath,
    versionRelative,
    isForgeVersionJsonShape,
  );

  const sentinel = mavenSentinelPath(input.directory, input.loader.fullVersion);
  const alreadyExtracted = await mavenSentinelMatches(sentinel, installerPath, input.directory);
  const extracted = alreadyExtracted
    ? undefined
    : await extractInstallerMavenEntries(installerPath, input.directory);

  const dataResolved = await resolveProfileData({
    profile,
    installerPath,
    directory: input.directory,
    entryExtraction: alreadyExtracted ? "reuse" : "force",
  });

  if (extracted !== undefined) {
    await writeMavenSentinel(sentinel, installerPath, extracted);
  }

  return { kind: "modern", profile, version, dataResolved };
};

const assembleModernForgePlan = async (args: {
  readonly input: PlanForgeInstallInput;
  readonly installerPath: string;
  readonly profile: ForgeInstallProfile;
  readonly version: ForgeVersionJson;
  readonly dataResolved: ResolvedProfileData;
}): Promise<ForgeInstallPlan> => {
  const { input, installerPath, profile, version, dataResolved } = args;
  const installerLibraries = planLibraryDownloads({
    libraries: profile.libraries,
    directory: input.directory,
    system: input.system,
    versionId: input.minecraft.version,
    category: DownloadCategories.FORGE_LIBRARY,
  });
  const versionLibraries = planLibraryDownloads({
    libraries: version.libraries,
    directory: input.directory,
    system: input.system,
    versionId: version.id,
    category: DownloadCategories.FORGE_LIBRARY,
  });

  const dedupedDownloads = dedupeBy(
    [...installerLibraries.downloads, ...versionLibraries.downloads],
    (action) => action.target,
  );
  const classpathFiles = dedupe([
    ...installerLibraries.classpathFiles,
    ...versionLibraries.classpathFiles,
  ]);

  const processorActions = await buildProcessorActions({
    profile,
    minecraft: input.minecraft,
    installerPath,
    directory: input.directory,
    dataResolved,
  });

  const versionJsonPath = targetPaths.versionJson(input.directory, version.id);
  const versionJson: WriteVersionJsonAction = {
    kind: InstallActionKinds.WRITE_VERSION_JSON,
    path: versionJsonPath,
    content: `${JSON.stringify(version, null, 2)}\n`,
  };

  return {
    libraryDownloads: dedupedDownloads,
    classpathFiles,
    processorActions,
    versionJson,
    versionId: version.id,
    profile,
    version,
  };
};

/**
 * Return the installer's `install_profile.json`, downloading the JAR only when the copy on
 * disk is absent, unreadable, or explicitly rejected by the caller.
 *
 * Forge publishes no hash or size for its installer JARs, so `downloadFile`'s skip-on-correct
 * can never fire for them — every plan would otherwise re-fetch 5-40 MB. The reuse gate is
 * therefore "the file exists and parses": a truncated or garbage JAR fails
 * `readJsonEntry` with `FORGE_INSTALLER_INVALID` / `ARCHIVE_INVALID`, which we treat as
 * "not on disk", delete, and re-download exactly once. `reuseInstaller: false` skips the gate
 * entirely — that is how {@link planForgeInstall} discards a JAR whose corruption only showed up
 * further into the archive.
 */
const ensureInstallerOnDisk = async (
  installerPath: string,
  input: PlanForgeInstallInput,
  reuseInstaller: boolean,
): Promise<ForgeInstallerProfile> => {
  if (reuseInstaller && (await fileExists(installerPath))) {
    const reused = await tryReadInstallerProfile(installerPath);
    if (reused !== null) return reused;
    await fs.unlink(installerPath).catch(() => {
      /* the re-download below overwrites it anyway; a failed unlink is not worth surfacing */
    });
  }
  await downloadFile(input.http, {
    url: input.loader.installerUrl,
    target: installerPath,
    category: DownloadCategories.FORGE_INSTALLER,
    ...withOptionalSignal(input.signal),
    ...withOptionalOnEvent(input.onEvent),
    ...withOptionalHostAllowList(input.hostAllowList),
  });
  return readJsonEntry<ForgeInstallerProfile>(
    installerPath,
    "install_profile.json",
    isForgeInstallerProfileShape,
  );
};

/**
 * Failures that mean "the installer JAR on disk cannot be trusted" — as opposed to a network
 * failure, a rejected (malicious) entry name, or a size-cap breach, none of which a fresh copy of
 * the same JAR would fix.
 *
 * @internal
 */
const REUSABLE_INSTALLER_FAILURES: ReadonlySet<string> = new Set([
  MinecraftKitErrorCodes.FORGE_INSTALLER_INVALID,
  MinecraftKitErrorCodes.ARCHIVE_INVALID,
  MinecraftKitErrorCodes.FILESYSTEM_READ_ERROR,
]);

const isReusableInstallerFailure = (error: unknown): boolean =>
  isMinecraftKitError(error) && REUSABLE_INSTALLER_FAILURES.has(error.code);

const tryReadInstallerProfile = async (
  installerPath: string,
): Promise<ForgeInstallerProfile | null> => {
  try {
    return await readJsonEntry<ForgeInstallerProfile>(
      installerPath,
      "install_profile.json",
      isForgeInstallerProfileShape,
    );
  } catch (error) {
    if (isReusableInstallerFailure(error)) return null;
    throw error;
  }
};

const mavenSentinelPath = (directory: string, fullVersion: string): string =>
  path.join(targetPaths.librariesDir(directory), `.forge-${fullVersion}.extracted`);

/**
 * Fingerprint of the installer JAR whose `maven/` tree has already been flushed to
 * `libraries/`. Living inside `libraries/` is deliberate: a user who deletes that directory
 * by hand takes the sentinel with it, so the next plan re-extracts.
 */
const installerFingerprint = async (installerPath: string): Promise<string> => {
  const stat = await fs.stat(installerPath);
  return `${stat.size}:${stat.mtimeMs}`;
};

/**
 * Sentinel layout: the installer fingerprint on the first line, then one `libraries/`-relative
 * path per line for every artifact the flush wrote (POSIX separators, so the file survives being
 * copied between platforms).
 */
const parseMavenSentinel = (
  content: string,
): { readonly fingerprint: string; readonly relativePaths: readonly string[] } => {
  const [fingerprint = "", ...rest] = content.split("\n").map((line) => line.trim());
  return { fingerprint, relativePaths: rest.filter((line) => line.length > 0) };
};

/**
 * Whether the `maven/` flush recorded by the sentinel is still valid: same installer JAR *and*
 * every artifact it produced still present.
 *
 * The second half is what makes the fast path safe. Installer-embedded artifacts carry
 * `url: ""`, so nothing downloads them — re-extracting is the only way to restore one that an
 * antivirus quarantine, a disk cleaner, or a hand-deleted file removed.
 */
const mavenSentinelMatches = async (
  sentinelPath: string,
  installerPath: string,
  directory: string,
): Promise<boolean> => {
  if (!(await fileExists(sentinelPath))) return false;
  try {
    const sentinel = parseMavenSentinel(await readText(sentinelPath));
    if (sentinel.fingerprint !== (await installerFingerprint(installerPath))) return false;
    for (const relativePath of sentinel.relativePaths) {
      if (!(await fileExists(mavenArtifactPath(directory, relativePath)))) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const mavenArtifactPath = (directory: string, relativePath: string): string =>
  path.join(targetPaths.librariesDir(directory), ...relativePath.split("/"));

const writeMavenSentinel = async (
  sentinelPath: string,
  installerPath: string,
  relativePaths: readonly string[],
): Promise<void> => {
  const lines = [await installerFingerprint(installerPath), ...relativePaths];
  await atomicWrite(sentinelPath, `${lines.join("\n")}\n`);
};

/**
 * Absolute paths of the installer-embedded artifacts the last `maven/` flush wrote for this
 * loader version, or an empty list when no flush has been recorded.
 *
 * Exposed for `verify.forge`: these files are on the launch classpath but carry `url: ""`, so
 * they appear in no `DownloadAction` and the plan-derived verification cannot see them. Reading
 * the sentinel is what lets verification report a quarantined embedded artifact instead of
 * calling the install valid.
 *
 * @internal
 */
export const listExtractedInstallerArtifacts = async (
  directory: string,
  fullVersion: string,
): Promise<readonly string[]> => {
  const sentinelPath = mavenSentinelPath(directory, fullVersion);
  if (!(await fileExists(sentinelPath))) return [];
  try {
    const sentinel = parseMavenSentinel(await readText(sentinelPath));
    return sentinel.relativePaths.map((relativePath) => mavenArtifactPath(directory, relativePath));
  } catch {
    return [];
  }
};

const planLegacyForgeInstall = async (args: {
  readonly input: PlanForgeInstallInput;
  readonly installerPath: string;
  readonly profile: LegacyForgeInstallProfile;
}): Promise<ForgeInstallPlan> => {
  await extractLegacyForgeUniversalJar(args.installerPath, args.profile, args.input.directory);

  const version = withEmbeddedLegacyForgeLibrary(args.profile);
  const versionLibraries = planLibraryDownloads({
    libraries: version.libraries,
    directory: args.input.directory,
    system: args.input.system,
    versionId: version.id,
    category: DownloadCategories.FORGE_LIBRARY,
  });
  const versionJsonPath = targetPaths.versionJson(args.input.directory, version.id);
  const versionJson: WriteVersionJsonAction = {
    kind: InstallActionKinds.WRITE_VERSION_JSON,
    path: versionJsonPath,
    content: `${JSON.stringify(version, null, 2)}\n`,
  };

  return {
    libraryDownloads: versionLibraries.downloads,
    classpathFiles: versionLibraries.classpathFiles,
    processorActions: [],
    versionJson,
    versionId: version.id,
    profile: args.profile,
    version,
  };
};

const withEmbeddedLegacyForgeLibrary = (profile: LegacyForgeInstallProfile): ForgeVersionJson => {
  const forgeCoord = profile.install.path;
  const forgeLibraryPath = mavenRelativePathFor(forgeCoord);
  return {
    ...profile.versionInfo,
    libraries: profile.versionInfo.libraries.map((library) => {
      if (library.name !== forgeCoord) return library;
      return {
        ...library,
        downloads: {
          ...library.downloads,
          artifact: {
            path: forgeLibraryPath,
            url: "",
            sha1: "",
            size: 0,
          },
        },
      };
    }),
  };
};
