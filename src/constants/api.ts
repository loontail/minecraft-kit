/**
 * Endpoint builders for every external HTTP request the library makes. Code MUST go through
 * these — never hard-code URLs at call sites.
 */

const PISTON_META = "https://piston-meta.mojang.com";
const RESOURCES = "https://resources.download.minecraft.net";
const FABRIC_META = "https://meta.fabricmc.net";
const FORGE_MAVEN = "https://maven.minecraftforge.net";
const FORGE_FILES = "https://files.minecraftforge.net";

/** Mojang Java-runtime metadata digest, embedded in the runtime index URL path. */
const RUNTIME_INDEX_DIGEST = "2ec0cc96c44e5a76b9c8b7c39df7210883d12871";

/**
 * Endpoint builders.
 *
 * @internal
 */
export const ApiEndpoints = {
  mojang: {
    /** Top-level Minecraft version manifest (v2). */
    versionManifest: (): string => `${PISTON_META}/mc/game/version_manifest_v2.json`,
    /** Mojang Java-runtime index. */
    runtimeIndex: (): string =>
      `${PISTON_META}/v1/products/java-runtime/${RUNTIME_INDEX_DIGEST}/all.json`,
  },
  resources: {
    /** Hash-addressed Minecraft asset object. */
    asset: (hash: string): string => `${RESOURCES}/${hash.slice(0, 2)}/${hash}`,
  },
  fabric: {
    gameVersions: (): string => `${FABRIC_META}/v2/versions/game`,
    loaderVersions: (): string => `${FABRIC_META}/v2/versions/loader`,
    loaderForGame: (minecraftVersion: string): string =>
      `${FABRIC_META}/v2/versions/loader/${encodeURIComponent(minecraftVersion)}`,
    profile: (minecraftVersion: string, loaderVersion: string): string =>
      `${FABRIC_META}/v2/versions/loader/${encodeURIComponent(minecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`,
  },
  forge: {
    /** Forge Maven listing of all builds across all MC versions. */
    mavenMetadata: (): string => `${FORGE_MAVEN}/net/minecraftforge/forge/maven-metadata.xml`,
    /** Slim "recommended" / "latest" promotion mapping. */
    promotions: (): string => `${FORGE_FILES}/net/minecraftforge/forge/promotions_slim.json`,
    /** URL of the modern installer JAR for a Maven version (e.g. `1.20.1-47.2.0`). */
    installer: (mavenVersion: string): string => {
      const filename = `forge-${mavenVersion}-installer.jar`;
      return `${FORGE_MAVEN}/net/minecraftforge/forge/${mavenVersion}/${filename}`;
    },
  },
} as const;

/**
 * Surface type useful for DI.
 *
 * @internal
 */
export type ApiEndpointsShape = typeof ApiEndpoints;
