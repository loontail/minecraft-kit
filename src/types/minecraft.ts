/**
 * Minecraft release channels matching the `type` field of Mojang version manifest entries.
 */
export const MinecraftChannels = {
  RELEASE: "release",
  SNAPSHOT: "snapshot",
  OLD_BETA: "old_beta",
  OLD_ALPHA: "old_alpha",
} as const;

/**
 * Channel literal as it appears in version manifest entries.
 */
export type MinecraftChannel = (typeof MinecraftChannels)[keyof typeof MinecraftChannels];

/**
 * Branded Minecraft version id (e.g. `"1.20.1"`, `"1.20.1-forge-47.2.0"`,
 * `"fabric-loader-0.14.21-1.20.1"`). Construct via `asMinecraftVersionId`
 * (exported from the package root) — the brand prevents accidentally
 * passing a player UUID, an asset-index id, or another opaque string where
 * the install/launch pipeline expects a Minecraft version id.
 *
 * The resolver brands at the Mojang-manifest boundary; reach for
 * `asMinecraftVersionId` when reading a saved version id from disk or when
 * the host environment supplies one.
 */
export type MinecraftVersionId = string & { readonly __brand: "MinecraftVersionId" };

/**
 * One entry from the top-level Minecraft `version_manifest_v2.json` listing.
 *
 * Note: this is a summary entry, not the full per-version manifest. Use
 * {@link ResolvedMinecraft} for the resolved/parsed full manifest.
 */
export type MinecraftVersionSummary = {
  readonly id: MinecraftVersionId;
  /** Release channel. */
  readonly type: MinecraftChannel;
  /** URL to the per-version manifest JSON. */
  readonly url: string;
  /** Manifest's last edit time (ISO-8601). */
  readonly time: string;
  /** Original release time (ISO-8601). */
  readonly releaseTime: string;
  /** SHA-1 of the per-version manifest (added in v2). */
  readonly sha1: string;
  /** Compliance level: 0 = legacy, 1 = secure-chat / safety features. */
  readonly complianceLevel: number;
};

/**
 * Subset of the per-version manifest used by resolvers and consumers.
 */
export type MinecraftVersionManifest = {
  readonly id: MinecraftVersionId;
  readonly type: MinecraftChannel | string;
  readonly mainClass: string;
  readonly assetIndex: AssetIndexReference;
  /** Asset index id (also exposed for legacy callers). */
  readonly assets: string;
  readonly downloads: MinecraftDownloads;
  readonly libraries: readonly MinecraftLibrary[];
  /** Modern (1.13+) argument structure. Mutually exclusive with {@link minecraftArguments}. */
  readonly arguments?: MinecraftArguments;
  /** Legacy (≤1.12.2) argument string. Mutually exclusive with {@link arguments}. */
  readonly minecraftArguments?: string;
  readonly javaVersion?: MinecraftJavaVersion;
  readonly logging?: MinecraftLogging;
  readonly inheritsFrom?: MinecraftVersionId;
  readonly releaseTime?: string;
  readonly time?: string;
  readonly minimumLauncherVersion?: number;
  readonly complianceLevel?: number;
};

/**
 * Reference to the asset-index JSON file.
 */
export type AssetIndexReference = {
  readonly id: string;
  readonly sha1: string;
  readonly size: number;
  readonly totalSize: number;
  readonly url: string;
};

/**
 * Per-platform downloads block of the Minecraft per-version manifest.
 */
export type MinecraftDownloads = {
  readonly client: ArtifactDownload;
  readonly server?: ArtifactDownload;
  readonly client_mappings?: ArtifactDownload;
  readonly server_mappings?: ArtifactDownload;
};

/**
 * A single hash-verified download.
 */
export type ArtifactDownload = {
  readonly sha1: string;
  readonly size: number;
  readonly url: string;
};

/**
 * Library entry. Combines vanilla, modern-natives, and legacy-classifier shapes.
 */
export type MinecraftLibrary = {
  readonly name: string;
  readonly downloads?: MinecraftLibraryDownloads;
  readonly natives?: Readonly<Record<string, string>>;
  readonly extract?: { readonly exclude?: readonly string[] };
  readonly rules?: readonly LibraryRule[];
  /** Some Fabric/Forge libraries carry only a Maven base URL plus a coordinate. */
  readonly url?: string;
};

/**
 * Library downloads block.
 */
export type MinecraftLibraryDownloads = {
  readonly artifact?: LibraryArtifact;
  readonly classifiers?: Readonly<Record<string, LibraryArtifact>>;
};

/**
 * An individual library artifact (jar/zip).
 */
export type LibraryArtifact = ArtifactDownload & {
  readonly path: string;
};

/**
 * Rule entry used by libraries and modern arguments.
 */
export type LibraryRule = {
  readonly action: "allow" | "disallow";
  readonly os?: { readonly name?: string; readonly arch?: string; readonly version?: string };
  readonly features?: Readonly<Record<string, boolean>>;
};

/**
 * Modern (1.13+) arguments structure.
 */
export type MinecraftArguments = {
  readonly game: readonly ArgumentEntry[];
  readonly jvm: readonly ArgumentEntry[];
};

/**
 * A single argument entry: bare string or rule-gated value.
 */
export type ArgumentEntry =
  | string
  | { readonly rules: readonly LibraryRule[]; readonly value: string | readonly string[] };

/**
 * Required Java runtime descriptor from the version manifest.
 */
export type MinecraftJavaVersion = {
  /** Mojang java-runtime component name (e.g. `java-runtime-gamma`). */
  readonly component: string;
  readonly majorVersion: number;
};

/**
 * Logging-config entry from the version manifest.
 */
export type MinecraftLogging = {
  readonly client?: {
    readonly argument: string;
    readonly file: ArtifactDownload & { readonly id: string };
    readonly type: string;
  };
};

/**
 * Fully resolved Minecraft version: summary + parsed manifest, ready to feed into
 * `kit.targets.create` or `kit.install.plan`.
 */
export type ResolvedMinecraft = {
  readonly version: MinecraftVersionId;
  readonly channel: MinecraftChannel;
  readonly manifest: MinecraftVersionManifest;
  readonly summary: MinecraftVersionSummary;
};

/**
 * Top-level shape returned by `version_manifest_v2.json`.
 *
 * @internal
 */
export type VersionManifestRoot = {
  readonly latest: { readonly release: string; readonly snapshot: string };
  readonly versions: readonly MinecraftVersionSummary[];
};

/**
 * Asset index document body.
 *
 * @internal
 */
export type AssetIndexDocument = {
  readonly objects: Readonly<Record<string, AssetObject>>;
  readonly virtual?: boolean;
  readonly map_to_resources?: boolean;
};

/**
 * A single asset object hash + size.
 *
 * @internal
 */
export type AssetObject = {
  readonly hash: string;
  readonly size: number;
};
