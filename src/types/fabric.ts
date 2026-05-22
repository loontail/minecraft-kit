import type { Loaders } from "./loader";
import type { MinecraftLibrary } from "./minecraft";

/**
 * Summary entry from `/v2/versions/loader`.
 *
 * @example
 * ```ts
 * import type { FabricLoaderSummary } from "@loontail/minecraft-kit";
 *
 * const loaders: readonly FabricLoaderSummary[] = await kit.versions.fabric.list();
 * const stable = loaders.filter((l) => l.stable);
 * console.log(`${stable.length} stable loaders, latest: ${stable[0]?.version}`);
 * ```
 */
export type FabricLoaderSummary = {
  readonly version: string;
  readonly stable: boolean;
  readonly maven: string;
  readonly build: number;
  readonly separator: string;
};

/**
 * Compatibility entry from `/v2/versions/loader/{minecraftVersion}`.
 *
 * @internal
 */
export type FabricCompatibilityEntry = {
  readonly loader: FabricLoaderSummary;
  readonly intermediary: {
    readonly version: string;
    readonly maven: string;
    readonly stable: boolean;
  };
};

/**
 * Fabric profile JSON returned by `/v2/versions/loader/{mc}/{loader}/profile/json`.
 *
 * @example
 * ```ts
 * import type { FabricProfile } from "@loontail/minecraft-kit";
 *
 * const fabric = await kit.versions.fabric.resolve({ minecraftVersion: "1.20.1" });
 * const profile: FabricProfile = fabric.profile;
 * console.log(profile.mainClass, `${profile.libraries.length} libraries`);
 * ```
 */
export type FabricProfile = {
  readonly id: string;
  readonly inheritsFrom: string;
  readonly type: string;
  readonly mainClass: string;
  readonly libraries: readonly MinecraftLibrary[];
  readonly arguments?: { readonly game?: readonly string[]; readonly jvm?: readonly string[] };
};

/**
 * Resolved Fabric loader for a specific Minecraft version.
 *
 * @example
 * ```ts
 * import { Loaders, type ResolvedFabricLoader } from "@loontail/minecraft-kit";
 *
 * const fabric: ResolvedFabricLoader = await kit.versions.fabric.resolve({
 *   minecraftVersion: "1.20.1",
 * });
 * console.log(fabric.type === Loaders.FABRIC, fabric.loaderVersion);
 * ```
 */
export type ResolvedFabricLoader = {
  readonly type: typeof Loaders.FABRIC;
  readonly minecraftVersion: string;
  readonly loaderVersion: string;
  readonly profile: FabricProfile;
};
