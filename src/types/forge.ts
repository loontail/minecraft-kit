import type { Loaders } from "./loader";
import type { MinecraftLibrary } from "./minecraft";

/** A Forge build entry derived from the Maven metadata XML. */
export type ForgeBuildSummary = {
  /** Full Maven version string e.g. `"1.20.1-47.2.0"`. */
  readonly fullVersion: string;
  /** Minecraft version e.g. `"1.20.1"`. */
  readonly minecraftVersion: string;
  /** The portion after the first dash, including any branch suffix. */
  readonly forgeVersion: string;
  /** True when this build is the recommended one per `promotions_slim.json`. */
  readonly isRecommended: boolean;
  /** True when this build is the latest one per `promotions_slim.json`. */
  readonly isLatest: boolean;
};

/**
 * Modern Forge `install_profile.json` (spec 1) shape — only fields we actually consume.
 *
 * @internal
 */
export type ForgeInstallProfile = {
  readonly spec: number;
  readonly profile: string;
  readonly version: string;
  readonly minecraft: string;
  readonly path?: string | null;
  readonly json: string;
  readonly logo?: string;
  readonly welcome?: string;
  readonly data: Readonly<Record<string, ForgeProfileData>>;
  readonly libraries: readonly MinecraftLibrary[];
  readonly processors: readonly ForgeProcessor[];
  readonly serverJarPath?: string;
};

/**
 * Side-keyed data value pair.
 *
 * @internal
 */
export type ForgeProfileData = {
  readonly client: string;
  readonly server: string;
};

/**
 * A single processor invocation.
 *
 * @internal
 */
export type ForgeProcessor = {
  readonly sides?: readonly ("client" | "server" | "extract")[];
  readonly jar: string;
  readonly classpath: readonly string[];
  readonly args: readonly string[];
  readonly outputs?: Readonly<Record<string, string>>;
};

/**
 * The version.json stored inside the Forge installer JAR.
 *
 * @internal
 */
export type ForgeVersionJson = {
  readonly id: string;
  readonly inheritsFrom: string;
  readonly type: string;
  readonly mainClass: string;
  readonly libraries: readonly MinecraftLibrary[];
  readonly arguments?: { readonly game?: readonly string[]; readonly jvm?: readonly string[] };
};

/** Resolved Forge loader. */
export type ResolvedForgeLoader = {
  readonly type: typeof Loaders.FORGE;
  readonly minecraftVersion: string;
  readonly forgeVersion: string;
  readonly fullVersion: string;
  readonly installerUrl: string;
};
