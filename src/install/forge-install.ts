/**
 * Forge install orchestrator. Downloads the installer JAR (needed on disk to read
 * `install_profile.json` before the rest of the plan can be produced - see
 * `docs/ai-context.md`), reads the installer's metadata via
 * {@link "./forge-installer-archive"}, plans the per-library actions plus modern processor
 * actions via {@link "./forge-processor-plan"}, and assembles the resulting
 * {@link ForgeInstallPlan}.
 *
 * @internal
 * @packageDocumentation
 */

import { ApiEndpoints } from "../constants/api";
import { dedupe, dedupeBy } from "../core/collections";
import { mavenRelativePathFor } from "../core/maven";
import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import { targetPaths } from "../core/paths";
import { downloadFile } from "../http/download";
import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import type {
  ForgeInstallerProfile,
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
import { buildProcessorActions, resolveProfileData } from "./forge-processor-plan";
import { planLibraryDownloads } from "./libraries";

export { decodeForgeDataValue, stripLiteralPrefix } from "./forge-data-value";
export type { ForgeDataValueDecoded } from "./forge-data-value";

/**
 * Outputs of {@link planForgeInstall}.
 *
 * @internal
 */
export type ForgeInstallPlan = {
  readonly installerDownload: DownloadAction;
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
};

/**
 * Plan the Forge install steps. Downloads the installer, parses modern or legacy
 * `install_profile.json`, extracts embedded artifacts to `libraries/`, and prepares
 * processor invocations when the profile declares processors.
 *
 * Unlike the vanilla/Fabric planners this is **not** side-effect-free: it hits the network
 * (installer download) and writes to disk (`libraries/` extraction). The actions it returns
 * cannot be enumerated without first reading `install_profile.json` out of the installer
 * JAR, so the download + extract are intrinsic to planning rather than deferrable to run.
 *
 * @internal
 */
export const planForgeInstall = async (input: PlanForgeInstallInput): Promise<ForgeInstallPlan> => {
  const installerPath = targetPaths.forgeInstaller(input.directory, input.loader.fullVersion);
  await downloadFile(input.http, {
    url: input.loader.installerUrl,
    target: installerPath,
    category: DownloadCategories.FORGE_INSTALLER,
    ...withOptionalSignal(input.signal),
    ...withOptionalOnEvent(input.onEvent),
  });

  const installerDownload: DownloadAction = {
    kind: InstallActionKinds.DOWNLOAD_FILE,
    url: input.loader.installerUrl,
    target: installerPath,
    category: DownloadCategories.FORGE_INSTALLER,
  };

  const profile = await readJsonEntry<ForgeInstallerProfile>(
    installerPath,
    "install_profile.json",
    isForgeInstallerProfileShape,
  );
  if (isLegacyForgeInstallProfileShape(profile)) {
    return await planLegacyForgeInstall({
      input,
      installerPath,
      installerDownload,
      profile,
    });
  }

  const versionRelative = profile.json.startsWith("/") ? profile.json.slice(1) : profile.json;
  const version = await readJsonEntry<ForgeVersionJson>(
    installerPath,
    versionRelative,
    isForgeVersionJsonShape,
  );

  await extractInstallerMavenEntries(installerPath, input.directory);

  const dataResolved = await resolveProfileData({
    profile,
    installerPath,
    directory: input.directory,
  });

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
    installerDownload,
    libraryDownloads: dedupedDownloads,
    classpathFiles,
    processorActions,
    versionJson,
    versionId: version.id,
    profile,
    version,
  };
};

const planLegacyForgeInstall = async (args: {
  readonly input: PlanForgeInstallInput;
  readonly installerPath: string;
  readonly installerDownload: DownloadAction;
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
    installerDownload: args.installerDownload,
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

/**
 * Build the Forge installer download URL. Used by repair flows that need to refetch.
 *
 * @internal
 */
export const forgeInstallerUrl = (fullVersion: string): string => {
  return ApiEndpoints.forge.installer(fullVersion);
};
