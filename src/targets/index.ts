import path from "node:path";
import { ASSETS_DIR, LIBRARIES_DIR, RUNTIMES_DIR, VERSIONS_DIR } from "../constants/files";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { dirExists, fileExists, listChildDirectories } from "../core/fs";
import { Loaders, type VersionPreferenceKind } from "../types/loader";
import { RuntimePreference, type RuntimePreferenceKind } from "../types/runtime";
import type { RuntimeSystem } from "../types/system";
import type {
  DiscoveredLoaderHint,
  DiscoveredRuntimeHint,
  DiscoveredTarget,
  Target,
  TargetCreateInput,
} from "../types/target";
import type { FabricVersionsApi } from "../versions/fabric";
import type { ForgeVersionsApi } from "../versions/forge";
import type { MinecraftVersionsApi } from "../versions/minecraft";
import type { RuntimeVersionsApi } from "../versions/runtime";

/**
 * Inputs to {@link TargetsApi.resolve}.
 *
 * @example
 * ```ts
 * import { Loaders, type TargetResolveInput } from "@loontail/minecraft-kit";
 *
 * const input: TargetResolveInput = {
 *   id: "vanilla-1.20.1",
 *   directory: "/games/minecraft/vanilla-1.20.1",
 *   minecraft: { version: "1.20.1" },
 *   loader: { type: Loaders.VANILLA },
 * };
 * const target = await kit.targets.resolve(input);
 * ```
 */
export type TargetResolveInput = {
  readonly id: string;
  readonly directory: string;
  readonly minecraft: { readonly version: string };
  readonly loader: TargetLoaderInput;
  readonly runtime?: {
    readonly preference?: RuntimePreferenceKind;
    /** Override the runtime component. Defaults to the Minecraft manifest's `javaVersion.component`. */
    readonly component?: string;
    /**
     * Custom install root (absolute path) holding the component directories.
     * When unset, runtime files live under `<directory>/runtime/`.
     */
    readonly installRoot?: string;
  };
  readonly system?: RuntimeSystem;
  readonly signal?: AbortSignal;
};

/**
 * Loader input variants.
 *
 * @example
 * ```ts
 * import { Loaders, VersionPreference, type TargetLoaderInput } from "@loontail/minecraft-kit";
 *
 * const vanilla: TargetLoaderInput = { type: Loaders.VANILLA };
 * const fabric: TargetLoaderInput = { type: Loaders.FABRIC, preference: VersionPreference.LATEST };
 * const forge: TargetLoaderInput = { type: Loaders.FORGE, version: "47.4.0" };
 * ```
 */
export type TargetLoaderInput =
  | { readonly type: typeof Loaders.VANILLA }
  | {
      readonly type: typeof Loaders.FABRIC;
      readonly preference?: VersionPreferenceKind;
      readonly version?: string;
    }
  | {
      readonly type: typeof Loaders.FORGE;
      readonly preference?: VersionPreferenceKind;
      readonly version?: string;
    };

/**
 * Inputs to {@link TargetsApi.list}.
 *
 * @example
 * ```ts
 * import type { TargetListInput } from "@loontail/minecraft-kit";
 *
 * const input: TargetListInput = { rootDir: "/games/minecraft" };
 * const installs = await kit.targets.list(input);
 * for (const t of installs) console.log(t.id, t.minecraftVersions);
 * ```
 */
export type TargetListInput = {
  readonly rootDir: string;
};

/**
 * Constructor inputs for {@link TargetsApi}.
 *
 * @example
 * ```ts
 * import {
 *   detectSystem,
 *   FabricVersionsApi,
 *   ForgeVersionsApi,
 *   MinecraftVersionsApi,
 *   RuntimeVersionsApi,
 *   TargetsApi,
 *   type TargetsApiContext,
 * } from "@loontail/minecraft-kit";
 *
 * const ctx: TargetsApiContext = {
 *   minecraft: new MinecraftVersionsApi(resolverCtx),
 *   fabric: new FabricVersionsApi(resolverCtx),
 *   forge: new ForgeVersionsApi(resolverCtx),
 *   runtime: new RuntimeVersionsApi(resolverCtx),
 *   system: detectSystem(),
 * };
 * const targets = new TargetsApi(ctx);
 * ```
 */
export type TargetsApiContext = {
  readonly minecraft: MinecraftVersionsApi;
  readonly fabric: FabricVersionsApi;
  readonly forge: ForgeVersionsApi;
  readonly runtime: RuntimeVersionsApi;
  readonly system: RuntimeSystem;
};

/**
 * Public Targets API surface.
 *
 * Available off a kit instance as `kit.targets`.
 *
 * @example
 * ```ts
 * import { Loaders, MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const target = await kit.targets.resolve({
 *   id: "modded",
 *   directory: "/games/minecraft/modded",
 *   minecraft: { version: "1.20.1" },
 *   loader: { type: Loaders.FABRIC },
 * });
 * ```
 */
export class TargetsApi {
  constructor(private readonly ctx: TargetsApiContext) {}

  /** The detected host system used by `resolve()` when no `system` is supplied. */
  get system(): RuntimeSystem {
    return this.ctx.system;
  }

  /** Build a {@link Target} from already-resolved components. */
  create(input: TargetCreateInput): Target {
    if (!input.id) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.INVALID_INPUT,
        "Target id must be non-empty",
      );
    }
    if (!input.directory) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.INVALID_INPUT,
        "Target directory must be non-empty",
      );
    }
    if (!path.isAbsolute(input.directory)) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.INVALID_INPUT,
        `Target directory must be an absolute path, got: ${input.directory}`,
        { context: { directory: input.directory } },
      );
    }
    if (input.loader.minecraftVersion !== input.minecraft.version) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.INVALID_INPUT,
        `Loader Minecraft version (${input.loader.minecraftVersion}) does not match resolved Minecraft (${input.minecraft.version})`,
        {
          context: {
            loaderMinecraft: input.loader.minecraftVersion,
            minecraftVersion: input.minecraft.version,
          },
        },
      );
    }
    return {
      id: input.id,
      directory: input.directory,
      minecraft: input.minecraft,
      loader: input.loader,
      runtime: input.runtime,
    };
  }

  /** Sugar API: resolve every component then assemble a target. */
  async resolve(input: TargetResolveInput): Promise<Target> {
    const minecraft = await this.ctx.minecraft.resolve({
      version: input.minecraft.version,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    });
    const system = input.system ?? this.ctx.system;
    const componentOverride = input.runtime?.component;
    const runtimeComponent = componentOverride ?? minecraft.manifest.javaVersion?.component;
    const resolvedRuntime = await this.ctx.runtime.resolve({
      system,
      ...(runtimeComponent !== undefined ? { component: runtimeComponent } : {}),
      preference: input.runtime?.preference ?? RuntimePreference.RECOMMENDED,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    });
    const runtime: import("../types/runtime").ResolvedRuntime =
      input.runtime?.installRoot !== undefined
        ? { ...resolvedRuntime, installRoot: input.runtime.installRoot }
        : resolvedRuntime;
    let loader: import("../types/loader").Loader;
    if (input.loader.type === Loaders.VANILLA) {
      loader = {
        type: Loaders.VANILLA,
        minecraftVersion: minecraft.version,
        minecraft,
      };
    } else if (input.loader.type === Loaders.FABRIC) {
      loader = await this.ctx.fabric.resolve({
        minecraftVersion: minecraft.version,
        ...(input.loader.preference !== undefined ? { preference: input.loader.preference } : {}),
        ...(input.loader.version !== undefined ? { loaderVersion: input.loader.version } : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      });
    } else {
      loader = await this.ctx.forge.resolve({
        minecraftVersion: minecraft.version,
        ...(input.loader.preference !== undefined ? { preference: input.loader.preference } : {}),
        ...(input.loader.version !== undefined ? { forgeVersion: input.loader.version } : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      });
    }
    return this.create({
      id: input.id,
      directory: input.directory,
      minecraft,
      loader,
      runtime,
    });
  }

  /** Scan a root directory for Minecraft installations. Returns only what is on disk. */
  async list(input: TargetListInput): Promise<readonly DiscoveredTarget[]> {
    if (!(await dirExists(input.rootDir))) return [];
    const subdirs = await listChildDirectories(input.rootDir);
    const results: DiscoveredTarget[] = [];
    for (const id of subdirs) {
      const directory = path.join(input.rootDir, id);
      const discovered = await discoverInstallation(id, directory);
      if (discovered) results.push(discovered);
    }
    return results;
  }
}

const discoverInstallation = async (
  id: string,
  directory: string,
): Promise<DiscoveredTarget | null> => {
  const versionsDir = path.join(directory, VERSIONS_DIR);
  const librariesDir = path.join(directory, LIBRARIES_DIR);
  const assetsDir = path.join(directory, ASSETS_DIR);
  const looksLikeInstall =
    (await dirExists(versionsDir)) &&
    ((await dirExists(librariesDir)) || (await dirExists(assetsDir)));
  if (!looksLikeInstall) return null;
  const versionDirs = await listChildDirectories(versionsDir);
  const minecraftVersions: string[] = [];
  const loaders: DiscoveredLoaderHint[] = [];
  for (const versionId of versionDirs) {
    const hint = inferLoaderFromVersionId(versionId);
    if (hint) {
      loaders.push(hint);
      if (hint.minecraftVersion && !minecraftVersions.includes(hint.minecraftVersion)) {
        minecraftVersions.push(hint.minecraftVersion);
      }
    } else {
      minecraftVersions.push(versionId);
    }
  }
  const runtime = await discoverRuntime(directory);
  return { id, directory, minecraftVersions, loaders, ...(runtime ? { runtime } : {}) };
};

const discoverRuntime = async (directory: string): Promise<DiscoveredRuntimeHint | undefined> => {
  const runtimeDir = path.join(directory, RUNTIMES_DIR);
  if (!(await dirExists(runtimeDir))) return undefined;
  let components: readonly string[];
  try {
    components = await listChildDirectories(runtimeDir);
  } catch {
    return undefined;
  }
  for (const component of components) {
    const root = path.join(runtimeDir, component);
    const javaPath = javaExecutablePath(root);
    if (await fileExists(javaPath)) {
      return { component, javaPath };
    }
  }
  return undefined;
};

const inferLoaderFromVersionId = (versionId: string): DiscoveredLoaderHint | null => {
  const fabricMatch = /^fabric-loader-([^-]+)-(.+)$/.exec(versionId);
  if (fabricMatch?.[1] && fabricMatch[2]) {
    return { type: Loaders.FABRIC, version: fabricMatch[1], minecraftVersion: fabricMatch[2] };
  }
  const forgeMatch = /^([^-]+)-forge-(.+)$/.exec(versionId);
  if (forgeMatch?.[1] && forgeMatch[2]) {
    return { type: Loaders.FORGE, minecraftVersion: forgeMatch[1], version: forgeMatch[2] };
  }
  return null;
};

const javaExecutablePath = (runtimeRoot: string): string => {
  if (process.platform === "win32") return path.join(runtimeRoot, "bin", "javaw.exe");
  if (process.platform === "darwin") {
    return path.join(runtimeRoot, "jre.bundle", "Contents", "Home", "bin", "java");
  }
  return path.join(runtimeRoot, "bin", "java");
};
