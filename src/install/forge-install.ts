import path from "node:path";
import { ApiEndpoints } from "../constants/api";
import { extractSingleEntry, openZip, readEntryBuffer } from "../core/archive";
import { dedupe, dedupeBy } from "../core/collections";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { atomicWrite } from "../core/fs";
import { parseJsonStrict } from "../core/json";
import { mavenRelativePathFor } from "../core/maven";
import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
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
    ...withOptionalSignal(input.signal),
    ...withOptionalOnEvent(input.onEvent),
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

/**
 * Decoded shape of one `install_profile.json#data[key].client` entry: which of Forge's
 * four prefix conventions it matched, plus the substituted payload. The four shapes are
 * fully separable from filesystem I/O so we can test the routing pure-functionally;
 * {@link resolveDataValue} then performs the actual maven path join / installer extract.
 *
 * @internal
 */
export type ForgeDataValueDecoded =
  /** `[g:a:v[:c]@ext]` — resolves to a path under `libraries/`. */
  | { readonly kind: "maven"; readonly coord: string }
  /** `'literal'` — both quotes stripped (matches Forge `Util.replaceTokens`). */
  | { readonly kind: "literal"; readonly value: string }
  /** `/path/inside/installer.ext` — entry to extract from the installer JAR. */
  | { readonly kind: "extract"; readonly entryName: string }
  /** Bare value — passed through verbatim. */
  | { readonly kind: "raw"; readonly value: string };

/**
 * Pure prefix-decoder for a Forge `install_profile.json` data value. The four prefix
 * conventions come from Forge's own `Util.replaceTokens` (see
 * `MinecraftForge/Installer src/main/java/net/minecraftforge/installer/json/Util.java`):
 * single-quote wrapping marks a literal, `[g:a:v]` a Maven coord, `/…` an entry inside
 * the installer JAR, and anything else is verbatim.
 *
 * Crucially, `'val'` strips BOTH quotes — not just the leading one. The trailing quote
 * matters because the data token can flow into processor `args` via `{KEY}` substitution
 * (not just into the `outputs` map, which gets a second pass of {@link stripLiteralPrefix}).
 *
 * @internal
 */
export const decodeForgeDataValue = (raw: string): ForgeDataValueDecoded => {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return { kind: "maven", coord: raw.slice(1, -1) };
  }
  if (raw.startsWith("'")) {
    return { kind: "literal", value: stripLiteralPrefix(raw) };
  }
  if (raw.startsWith("/")) {
    return { kind: "extract", entryName: raw.slice(1) };
  }
  return { kind: "raw", value: raw };
};

const resolveDataValue = async (
  raw: string,
  installerPath: string,
  directory: string,
): Promise<ResolvedTokenValue> => {
  const decoded = decodeForgeDataValue(raw);
  switch (decoded.kind) {
    case "maven": {
      const relativePath = mavenRelativePathFor(decoded.coord);
      return {
        value: path.join(targetPaths.librariesDir(directory), relativePath),
        isPath: true,
      };
    }
    case "literal":
      return { value: decoded.value, isPath: false };
    case "extract": {
      const destination = path.join(
        targetPaths.librariesDir(directory),
        "forge-data",
        decoded.entryName,
      );
      await extractSingleEntry(installerPath, decoded.entryName, destination);
      return { value: destination, isPath: true };
    }
    case "raw":
      return { value: decoded.value, isPath: false };
  }
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
    // Resolve `[g:a:v[:classifier][@ext]]` to an absolute path under the
    // libraries directory. The reference Forge installer (PostProcessors.
    // replaceTokens / Util.getPath) does the same: maven coords in processor
    // args are always library paths, not bare maven-style relative paths.
    // Returning a relative path here makes Java resolve it against the
    // launcher's cwd at spawn time — which is process.cwd(), not the client
    // folder — so installertools can't find e.g. mcp_config-<v>.zip and the
    // first processor that takes a `[maven]` input dies with
    // "Input does not exist: de\oceanlabs\...".
    const relative = mavenRelativePathFor(raw.slice(1, -1));
    const librariesToken = tokens.LIBRARY_DIR;
    if (librariesToken !== undefined) {
      return path.join(librariesToken.value, relative);
    }
    return path.join(...relative.split("/"));
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
