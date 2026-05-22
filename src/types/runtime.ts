import type { RuntimeSystem } from "./system";

/**
 * Mojang Java-runtime component identifiers. New components appear over time
 * (e.g. `java-runtime-delta` for Java 21).
 *
 * The launcher must respect the `javaVersion.component` field declared by the per-version
 * Minecraft manifest. This list captures the set we have direct knowledge about; unknown
 * components are still allowed and resolved dynamically against the runtime index.
 */
export const RuntimeComponents = {
  JRE_LEGACY: "jre-legacy",
  JAVA_RUNTIME_ALPHA: "java-runtime-alpha",
  JAVA_RUNTIME_BETA: "java-runtime-beta",
  JAVA_RUNTIME_GAMMA: "java-runtime-gamma",
  JAVA_RUNTIME_GAMMA_SNAPSHOT: "java-runtime-gamma-snapshot",
  JAVA_RUNTIME_DELTA: "java-runtime-delta",
  JAVA_RUNTIME_EPSILON: "java-runtime-epsilon",
  MINECRAFT_JAVA_EXE: "minecraft-java-exe",
} as const;

/** Runtime component literal. */
export type RuntimeComponent = string;

/** User-supplied resolution preferences. */
export const RuntimePreference = {
  /** Component declared by the Minecraft manifest. */
  RECOMMENDED: "recommended",
  /** Newest component available for the platform. */
  LATEST: "latest",
} as const;

/** Runtime preference literal. */
export type RuntimePreferenceKind = (typeof RuntimePreference)[keyof typeof RuntimePreference];

/**
 * Top-level runtime index returned by Mojang.
 *
 * @internal
 */
export type RuntimeIndex = Readonly<Record<string, RuntimeIndexPlatform>>;

/**
 * Per-platform component map inside the runtime index.
 *
 * @internal
 */
export type RuntimeIndexPlatform = Readonly<Record<string, readonly RuntimeIndexEntry[]>>;

/**
 * A single available runtime release.
 *
 * @internal
 */
export type RuntimeIndexEntry = {
  readonly availability: { readonly group: number; readonly progress: number };
  readonly manifest: { readonly sha1: string; readonly size: number; readonly url: string };
  readonly version: { readonly name: string; readonly released: string };
};

/**
 * Inner per-component file manifest.
 *
 * @internal
 */
export type RuntimeFilesManifest = {
  readonly files: Readonly<Record<string, RuntimeFileEntry>>;
};

/**
 * A single file in the runtime manifest.
 *
 * @internal
 */
export type RuntimeFileEntry = RuntimeFileFile | RuntimeFileDirectory | RuntimeFileLink;

/**
 * A file entry: real bytes to download. Mojang advertises an optional `lzma` sidecar
 * alongside `raw`; the kit ignores it and always downloads the raw payload.
 *
 * @internal
 */
export type RuntimeFileFile = {
  readonly type: "file";
  readonly executable: boolean;
  readonly downloads: {
    readonly raw: { readonly sha1: string; readonly size: number; readonly url: string };
    readonly lzma?: { readonly sha1: string; readonly size: number; readonly url: string };
  };
};

/**
 * A directory placeholder.
 *
 * @internal
 */
export type RuntimeFileDirectory = {
  readonly type: "directory";
};

/**
 * A relative symlink.
 *
 * @internal
 */
export type RuntimeFileLink = {
  readonly type: "link";
  readonly target: string;
};

/** Resolved runtime ready to install or launch with. */
export type ResolvedRuntime = {
  /** Mojang component name (e.g. `java-runtime-gamma`). */
  readonly component: string;
  /** Platform key inside the runtime index (e.g. `windows-x64`). */
  readonly platformKey: string;
  /** Version name (e.g. `"17.0.8"`). */
  readonly versionName: string;
  /** Major Java version when known. */
  readonly majorVersion?: number;
  readonly system: RuntimeSystem;
  /** URL of the per-component file manifest. */
  readonly manifestUrl: string;
  /** SHA-1 of the file manifest. */
  readonly manifestSha1: string;
  /**
   * Absolute path containing component directories. When set, runtime files for `component`
   * live at `<installRoot>/<component>/...`. When unset, defaults to `<target.directory>/runtime`.
   */
  readonly installRoot?: string;
};
