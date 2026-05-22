import path from "node:path";
import { DEFAULT_LIBRARY_REPOSITORY } from "../constants/maven";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { mavenRelativePathFor, parseMavenCoordinate } from "../core/maven";
import { targetPaths } from "../core/paths";
import { archDigit, evaluateRules, resolveArchPlaceholder } from "../core/rules";
import {
  type DownloadAction,
  type DownloadCategory,
  type ExtractNativeAction,
  InstallActionKinds,
} from "../types/install";
import type { LibraryArtifact, MinecraftLibrary } from "../types/minecraft";
import type { RuntimeSystem } from "../types/system";

/**
 * Outputs of {@link planLibraryDownloads}.
 *
 * @internal
 */
export type LibraryPlan = {
  readonly downloads: readonly DownloadAction[];
  readonly nativeExtractions: readonly ExtractNativeAction[];
  readonly classpathFiles: readonly string[];
};

/**
 * Walk a library list, evaluate rules against the system, and produce concrete download +
 * native-extraction actions. Library entries that don't apply on the target platform are
 * silently filtered.
 *
 * @internal
 */
export const planLibraryDownloads = (input: {
  readonly libraries: readonly MinecraftLibrary[];
  readonly directory: string;
  readonly system: RuntimeSystem;
  readonly versionId: string;
  readonly category: DownloadCategory;
}): LibraryPlan => {
  const downloads: DownloadAction[] = [];
  const nativeExtractions: ExtractNativeAction[] = [];
  const classpathFiles: string[] = [];
  const seenPaths = new Set<string>();
  const nativesDir = targetPaths.nativesDir(input.directory, input.versionId);
  for (const library of input.libraries) {
    if (!evaluateRules(library.rules, { system: input.system })) continue;

    const artifact = pickPrimaryArtifact(library);
    if (artifact) {
      const targetPath = path.join(
        targetPaths.librariesDir(input.directory),
        artifact.relativePath,
      );
      if (!seenPaths.has(targetPath)) {
        seenPaths.add(targetPath);
        // Empty URL in a Forge install_profile / version JSON means "the file is
        // provided by the installer's `maven/` extraction or by a processor output —
        // do not issue a download." Still record the path on the classpath so the
        // launch composer can find it after install.
        if (artifact.url) {
          downloads.push({
            kind: InstallActionKinds.DOWNLOAD_FILE,
            url: artifact.url,
            target: targetPath,
            ...(artifact.sha1 !== undefined ? { expectedSha1: artifact.sha1 } : {}),
            ...(artifact.size !== undefined ? { expectedSize: artifact.size } : {}),
            category: input.category,
          });
        }
        classpathFiles.push(targetPath);
      }
    }

    const native = pickNative(library, input.system);
    if (native) {
      const targetPath = path.join(targetPaths.librariesDir(input.directory), native.relativePath);
      if (!seenPaths.has(targetPath)) {
        seenPaths.add(targetPath);
        if (native.url) {
          downloads.push({
            kind: InstallActionKinds.DOWNLOAD_FILE,
            url: native.url,
            target: targetPath,
            ...(native.sha1 !== undefined ? { expectedSha1: native.sha1 } : {}),
            ...(native.size !== undefined ? { expectedSize: native.size } : {}),
            category: input.category,
          });
        }
      }
      nativeExtractions.push({
        kind: InstallActionKinds.EXTRACT_NATIVE,
        source: targetPath,
        destination: nativesDir,
        exclude: library.extract?.exclude ?? ["META-INF/"],
      });
    }
  }
  return { downloads, nativeExtractions, classpathFiles };
};

type ArtifactDescription = {
  readonly relativePath: string;
  readonly url: string;
  readonly sha1: string | undefined;
  readonly size: number | undefined;
};

const pickPrimaryArtifact = (library: MinecraftLibrary): ArtifactDescription | null => {
  if (library.downloads?.artifact) {
    return artifactFromDownload(library.downloads.artifact);
  }
  if (library.url) {
    return mavenArtifactFromCoord(library.name, library.url);
  }
  if (library.name && !library.natives) {
    return mavenArtifactFromCoord(library.name, DEFAULT_LIBRARY_REPOSITORY);
  }
  return null;
};

const pickNative = (
  library: MinecraftLibrary,
  system: RuntimeSystem,
): ArtifactDescription | null => {
  if (!library.natives) return null;
  const classifierTemplate = library.natives[system.os];
  if (!classifierTemplate) return null;
  const classifier = resolveArchPlaceholder(classifierTemplate, archDigit(system.arch));
  const classifierArtifact = library.downloads?.classifiers?.[classifier];
  if (classifierArtifact) {
    return artifactFromDownload(classifierArtifact);
  }
  if (library.url || library.name) {
    const coord = parseMavenCoordinate(library.name);
    const withClassifier = `${coord.group}:${coord.artifact}:${coord.version}:${classifier}`;
    return mavenArtifactFromCoord(withClassifier, library.url ?? DEFAULT_LIBRARY_REPOSITORY);
  }
  return null;
};

const artifactFromDownload = (artifact: LibraryArtifact): ArtifactDescription => {
  return {
    relativePath: artifact.path,
    url: artifact.url,
    sha1: artifact.sha1,
    size: artifact.size,
  };
};

const mavenArtifactFromCoord = (coord: string, baseUrl: string): ArtifactDescription => {
  const relativePath = mavenRelativePathFor(coord);
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  if (!relativePath) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.MANIFEST_INVALID,
      `Invalid library coordinate: ${coord}`,
      {
        context: { input: coord },
      },
    );
  }
  return {
    relativePath,
    url: `${normalizedBase}${relativePath}`,
    sha1: undefined,
    size: undefined,
  };
};
