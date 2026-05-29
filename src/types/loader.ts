import type { ResolvedFabricLoader } from "./fabric";
import type { ResolvedForgeLoader } from "./forge";
import type { ResolvedVanillaLoader } from "./vanilla";

/**
 * Discriminator literal identifying which mod loader is active for a target.
 *
 * Use the {@link Loaders} const object instead of bare strings. `loader.type === Loaders.FABRIC`
 * is preferred over `loader.type === "fabric"`.
 *
 * @example
 * ```ts
 * import { asMinecraftVersionId, Loaders } from "@loontail/minecraft-kit";
 *
 * await kit.targets.resolve({
 *   id: "modded",
 *   directory: "/games/modded",
 *   minecraft: { version: asMinecraftVersionId("1.20.1") },
 *   loader: { type: Loaders.FABRIC },
 * });
 * ```
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
 *
 * @example
 * ```ts
 * import { Loaders, type LoaderKind } from "@loontail/minecraft-kit";
 *
 * function display(kind: LoaderKind): string {
 *   if (kind === Loaders.VANILLA) return "Vanilla";
 *   if (kind === Loaders.FABRIC) return "Fabric";
 *   return "Forge";
 * }
 * ```
 */
export type LoaderKind = (typeof Loaders)[keyof typeof Loaders];

/**
 * A fully resolved loader pinned to a specific Minecraft version. Use the `type` field to
 * narrow to the concrete shape.
 *
 * @example
 * ```ts
 * import { Loaders, type Loader } from "@loontail/minecraft-kit";
 *
 * function describe(loader: Loader): string {
 *   if (loader.type === Loaders.FABRIC) return `Fabric ${loader.loaderVersion}`;
 *   if (loader.type === Loaders.FORGE) return `Forge ${loader.forgeVersion}`;
 *   return `Vanilla ${loader.minecraftVersion}`;
 * }
 * ```
 */
export type Loader = ResolvedVanillaLoader | ResolvedFabricLoader | ResolvedForgeLoader;

/**
 * Resolution preference used when a user wants the latest, recommended, or a specific version.
 * Preferences are inputs to resolvers; resolved targets always carry concrete versions.
 *
 * @example
 * ```ts
 * import { VersionPreference } from "@loontail/minecraft-kit";
 *
 * await kit.versions.fabric.resolve({
 *   minecraftVersion: "1.20.1",
 *   preference: VersionPreference.LATEST,
 * });
 * ```
 */
export const VersionPreference = {
  LATEST: "latest",
  RECOMMENDED: "recommended",
} as const;

/**
 * Resolution-preference literal.
 *
 * @example
 * ```ts
 * import { VersionPreference, type VersionPreferenceKind } from "@loontail/minecraft-kit";
 *
 * const wantStable = (pref: VersionPreferenceKind) => pref === VersionPreference.RECOMMENDED;
 * ```
 */
export type VersionPreferenceKind = (typeof VersionPreference)[keyof typeof VersionPreference];
