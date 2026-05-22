import path from "node:path";
import { ApiEndpoints } from "../constants/api";
import { extractSingleEntry, openZip, readEntryBuffer } from "../core/archive";
import { dedupe, dedupeBy } from "../core/collections";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { atomicWrite } from "../core/fs";
import { parseJsonStrict } from "../core/json";
import { mavenRelativePathFor } from "../core/maven";
import { targetPaths } from "../core/paths";
import { downloadFile } from "../http/download";
import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import type {
  ForgeInstallProfile,
  ForgeProcessor,
  ForgeVersionJson,
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
import { planLibraryDownloads } from "./libraries";

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
  readonly profile: ForgeInstallProfile;
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
 * Plan the Forge install steps. Downloads the installer, parses install_profile + version.json,
 * extracts embedded artifacts to `libraries/`, and prepares processor invocations.
 *
 * @internal
 */
export const planForgeInstall = async (input: PlanForgeInstallInput): Promise<ForgeInstallPlan> => {
  const installerPath = targetPaths.forgeInstaller(input.directory, input.loader.fullVersion);
  await downloadFile(input.http, {
    url: input.loader.installerUrl,
    target: installerPath,
    category: DownloadCategories.FORGE_INSTALLER,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
    ...(input.onEvent !== undefined ? { onEvent: input.onEvent } : {}),
  });

  const installerDownload: DownloadAction = {
    kind: InstallActionKinds.DOWNLOAD_FILE,
    url: input.loader.installerUrl,
    target: installerPath,
    category: DownloadCategories.FORGE_INSTALLER,
  };

  const profile = await readJsonEntry<ForgeInstallProfile>(installerPath, "install_profile.json");
  const versionRelative = profile.json.startsWith("/") ? profile.json.slice(1) : profile.json;
  const version = await readJsonEntry<ForgeVersionJson>(installerPath, versionRelative);

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

const readJsonEntry = async <T>(zipPath: string, entryName: string): Promise<T> => {
  const buffer = await readEntryBuffer(zipPath, entryName);
  if (!buffer) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.FORGE_INSTALLER_INVALID,
      `Forge installer is missing required entry: ${entryName}`,
      { context: { filePath: zipPath, entryName } },
    );
  }
  return parseJsonStrict<T>(buffer.toString("utf8"), {
    code: MinecraftKitErrorCodes.FORGE_INSTALLER_INVALID,
    message: `Forge installer entry is not valid JSON: ${entryName}`,
    context: { filePath: zipPath, entryName },
  });
};

const extractInstallerMavenEntries = async (
  installerPath: string,
  directory: string,
): Promise<void> => {
  const reader = await openZip(installerPath);
  try {
    for await (const entry of reader.entries()) {
      if (!entry.name.startsWith("maven/") || entry.isDirectory) continue;
      const relativeWithinLibraries = entry.name.slice("maven/".length);
      const destination = path.join(targetPaths.librariesDir(directory), relativeWithinLibraries);
      const buffer = await entry.readBuffer();
      await atomicWrite(destination, buffer);
    }
  } finally {
    reader.close();
  }
};

type ResolvedProfileData = {
  readonly tokens: Readonly<Record<string, ResolvedTokenValue>>;
};

type ResolvedTokenValue = {
  /** Final string used in argument substitution. */
  readonly value: string;
  /** When true, the value is an on-disk path; otherwise it is a literal. */
  readonly isPath: boolean;
};

const resolveProfileData = async (input: {
  readonly profile: ForgeInstallProfile;
  readonly installerPath: string;
  readonly directory: string;
}): Promise<ResolvedProfileData> => {
  const tokens: Record<string, ResolvedTokenValue> = {};
  for (const [key, sided] of Object.entries(input.profile.data)) {
    const raw = sided.client;
    tokens[key] = await resolveDataValue(raw, input.installerPath, input.directory);
  }
  return { tokens };
};

const resolveDataValue = async (
  raw: string,
  installerPath: string,
  directory: string,
): Promise<ResolvedTokenValue> => {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const coord = raw.slice(1, -1);
    const relativePath = mavenRelativePathFor(coord);
    return {
      value: path.join(targetPaths.librariesDir(directory), relativePath),
      isPath: true,
    };
  }
  if (raw.startsWith("'")) {
    return { value: raw.slice(1), isPath: false };
  }
  if (raw.startsWith("/")) {
    const entryName = raw.slice(1);
    const destination = path.join(targetPaths.librariesDir(directory), "forge-data", entryName);
    await extractSingleEntry(installerPath, entryName, destination);
    return { value: destination, isPath: true };
  }
  return { value: raw, isPath: false };
};

const buildProcessorActions = async (input: {
  readonly profile: ForgeInstallProfile;
  readonly minecraft: ResolvedMinecraft;
  readonly installerPath: string;
  readonly directory: string;
  readonly dataResolved: ResolvedProfileData;
}): Promise<readonly RunForgeProcessorAction[]> => {
  const builtIns: Record<string, ResolvedTokenValue> = {
    SIDE: { value: "client", isPath: false },
    MINECRAFT_JAR: {
      value: targetPaths.versionJar(input.directory, input.minecraft.version),
      isPath: true,
    },
    MINECRAFT_VERSION: { value: input.minecraft.version, isPath: false },
    ROOT: { value: input.directory, isPath: true },
    INSTALLER: { value: input.installerPath, isPath: true },
    LIBRARY_DIR: { value: targetPaths.librariesDir(input.directory), isPath: true },
  };
  const tokens: Readonly<Record<string, ResolvedTokenValue>> = {
    ...builtIns,
    ...input.dataResolved.tokens,
  };
  const actions: RunForgeProcessorAction[] = [];
  let index = 0;
  for (const processor of input.profile.processors) {
    if (!processorAppliesToClient(processor)) {
      continue;
    }
    const action = buildProcessorAction({
      processor,
      directory: input.directory,
      tokens,
      index,
    });
    actions.push(action);
    index++;
  }
  return actions;
};

const processorAppliesToClient = (processor: ForgeProcessor): boolean => {
  if (!processor.sides || processor.sides.length === 0) return true;
  return processor.sides.includes("client");
};

/**
 * Build the `RUN_FORGE_PROCESSOR` action for one processor entry.
 *
 * The classpath starts with the raw processor JAR — `Main-Class` is read from that JAR
 * at runtime, not here, because newer Forge versions ship some processor JARs as regular
 * Maven libraries that aren't downloaded yet at planning time.
 */
const buildProcessorAction = (input: {
  readonly processor: ForgeProcessor;
  readonly directory: string;
  readonly tokens: Readonly<Record<string, ResolvedTokenValue>>;
  readonly index: number;
}): RunForgeProcessorAction => {
  const jarPath = path.join(
    targetPaths.librariesDir(input.directory),
    mavenRelativePathFor(input.processor.jar),
  );
  const classpath = [
    jarPath,
    ...input.processor.classpath.map((coord) =>
      path.join(targetPaths.librariesDir(input.directory), mavenRelativePathFor(coord)),
    ),
  ];
  const args = input.processor.args.map((arg) => substituteToken(arg, input.tokens));
  const outputs: Record<string, string> = {};
  if (input.processor.outputs) {
    for (const [key, value] of Object.entries(input.processor.outputs)) {
      outputs[substituteToken(key, input.tokens)] = stripLiteralPrefix(
        substituteToken(value, input.tokens),
      );
    }
  }
  return {
    kind: InstallActionKinds.RUN_FORGE_PROCESSOR,
    index: input.index,
    classpath,
    args,
    outputs,
  };
};

const substituteToken = (
  raw: string,
  tokens: Readonly<Record<string, ResolvedTokenValue>>,
): string => {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return path.join(...mavenRelativePathFor(raw.slice(1, -1)).split("/"));
  }
  return raw.replaceAll(/\{([A-Z0-9_]+)\}/g, (match, key: string) => {
    const token = tokens[key];
    if (token === undefined) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.FORGE_INSTALLER_INVALID,
        `Unknown processor token: ${match}`,
        {
          context: { token: key },
        },
      );
    }
    return token.value;
  });
};

/**
 * Strip the single-quote wrapping that Forge `install_profile.json` puts around literal
 * values (in contrast to `{token}` placeholders and `[g:a:v]` maven coords). Both the
 * leading and trailing quote are removed when present.
 *
 * @internal
 */
export const stripLiteralPrefix = (value: string): string => {
  const stripped = value.startsWith("'") ? value.slice(1) : value;
  return stripped.endsWith("'") ? stripped.slice(0, -1) : stripped;
};

/**
 * Build the Forge installer download URL. Used by repair flows that need to refetch.
 *
 * @internal
 */
export const forgeInstallerUrl = (fullVersion: string): string => {
  return ApiEndpoints.forge.installer(fullVersion);
};
