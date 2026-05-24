/**
 * Forge processor planning: decode `install_profile.json#data[*]` values, resolve them
 * (some require extracting embedded entries to disk), and produce one
 * `RUN_FORGE_PROCESSOR` action per applicable processor. The token-substitution rules
 * mirror Forge's own `Util.replaceTokens`.
 *
 * @internal
 * @packageDocumentation
 */

import path from "node:path";
import { extractSingleEntry } from "../core/archive";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { mavenRelativePathFor } from "../core/maven";
import { targetPaths } from "../core/paths";
import type { ForgeInstallProfile, ForgeProcessor } from "../types/forge";
import { InstallActionKinds, type RunForgeProcessorAction } from "../types/install";
import type { ResolvedMinecraft } from "../types/minecraft";
import { decodeForgeDataValue, stripLiteralPrefix } from "./forge-data-value";

/**
 * A token value resolved against the installer JAR / disk layout: the substituted string
 * and whether it points at a filesystem path (currently informational; reserved for
 * future processors that need different escaping for paths vs. literals).
 *
 * @internal
 */
export type ResolvedTokenValue = {
  /** Final string used in argument substitution. */
  readonly value: string;
  /** When true, the value is an on-disk path; otherwise it is a literal. */
  readonly isPath: boolean;
};

/**
 * Output of {@link resolveProfileData}: every `install_profile.json#data[*]` key with its
 * substituted on-disk / literal value.
 *
 * @internal
 */
export type ResolvedProfileData = {
  readonly tokens: Readonly<Record<string, ResolvedTokenValue>>;
};

/**
 * Resolve every `data[key].client` entry from `install_profile.json`. May extract files
 * from the installer JAR (`/path/inside.ext` entries) so the function is async and
 * touches the disk under `libraries/forge-data/`.
 *
 * @internal
 */
export const resolveProfileData = async (input: {
  readonly profile: ForgeInstallProfile;
  readonly installerPath: string;
  readonly directory: string;
}): Promise<ResolvedProfileData> => {
  const tokens: Record<string, ResolvedTokenValue> = {};
  for (const [key, sided] of Object.entries(input.profile.data)) {
    tokens[key] = await resolveDataValue(sided.client, input.installerPath, input.directory);
  }
  return { tokens };
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

/**
 * Produce one `RUN_FORGE_PROCESSOR` action per applicable processor. Built-in tokens
 * (`SIDE`, `MINECRAFT_JAR`, `MINECRAFT_VERSION`, `ROOT`, `INSTALLER`, `LIBRARY_DIR`)
 * merge with the resolved `data[*]` tokens before substitution.
 *
 * @internal
 */
export const buildProcessorActions = async (input: {
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
    actions.push(buildProcessorAction({ processor, directory: input.directory, tokens, index }));
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

/**
 * Substitute one processor-arg or output value against the resolved token table.
 *
 * `[g:a:v[:classifier][@ext]]` is resolved to an *absolute* path under the libraries
 * directory; the reference Forge installer (`PostProcessors.replaceTokens` /
 * `Util.getPath`) does the same. Returning a relative path here would make Java resolve
 * it against the launcher's cwd at spawn time — which is `process.cwd()`, not the
 * client folder — so installertools couldn't find e.g. `mcp_config-<v>.zip` and the
 * first processor that takes a `[maven]` input would die with
 * `Input does not exist: de\oceanlabs\…`. `{KEY}` placeholders are looked up in the
 * token table; an unknown key throws `FORGE_INSTALLER_INVALID`.
 */
const substituteToken = (
  raw: string,
  tokens: Readonly<Record<string, ResolvedTokenValue>>,
): string => {
  if (raw.startsWith("[") && raw.endsWith("]")) {
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
        { context: { token: key } },
      );
    }
    return token.value;
  });
};
