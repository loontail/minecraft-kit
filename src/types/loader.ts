import type { ResolvedFabricLoader } from "./fabric";
import type { ResolvedForgeLoader } from "./forge";
import type { ResolvedVanillaLoader } from "./vanilla";

/**
 * Discriminator literal identifying which mod loader is active for a target.
 *
 * Use the {@link Loaders} const object instead of bare strings. `loader.type === Loaders.FABRIC`
 * is preferred over `loader.type === "fabric"`.
 */
export const Loaders = {
  /** Plain vanilla Minecraft, no mod loader. */
  VANILLA: "vanilla",
  /** Fabric mod loader. */
  FABRIC: "fabric",
  /** Forge mod loader. */
  FORGE: "forge",
} as const;

/**
 * Loader-kind literal (used as discriminator on loader objects).
 */
export type LoaderKind = (typeof Loaders)[keyof typeof Loaders];

/**
 * A fully resolved loader pinned to a specific Minecraft version. Use the `type` field to
 * narrow to the concrete shape.
 */
export type Loader = ResolvedVanillaLoader | ResolvedFabricLoader | ResolvedForgeLoader;

/**
 * Resolution preference used when a user wants the latest, recommended, or a specific version.
 * Preferences are inputs to resolvers; resolved targets always carry concrete versions.
 */
export const VersionPreference = {
  LATEST: "latest",
  RECOMMENDED: "recommended",
} as const;

/**
 * Resolution-preference literal.
 */
export type VersionPreferenceKind = (typeof VersionPreference)[keyof typeof VersionPreference];
