import type { Loaders } from "./loader";
import type { MinecraftLibrary } from "./minecraft";

/** Summary entry from `/v2/versions/loader`. */
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

/** Fabric profile JSON returned by `/v2/versions/loader/{mc}/{loader}/profile/json`. */
export type FabricProfile = {
  readonly id: string;
  readonly inheritsFrom: string;
  readonly type: string;
  readonly mainClass: string;
  readonly libraries: readonly MinecraftLibrary[];
  readonly arguments?: { readonly game?: readonly string[]; readonly jvm?: readonly string[] };
};

/** Resolved Fabric loader for a specific Minecraft version. */
export type ResolvedFabricLoader = {
  readonly type: typeof Loaders.FABRIC;
  readonly minecraftVersion: string;
  readonly loaderVersion: string;
  readonly profile: FabricProfile;
};
