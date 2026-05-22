/**
 * Minecraft release channels matching the `type` field of Mojang version manifest entries.
 *
 * @example
 * ```ts
 * import { MinecraftChannels } from "@loontail/minecraft-kit";
 *
 * const releases = await kit.versions.minecraft.list({ channel: MinecraftChannels.RELEASE });
 * console.log(`${releases.length} releases since 2009`);
 * ```
 */
export const MinecraftChannels = {
  RELEASE: "release",
  SNAPSHOT: "snapshot",
  OLD_BETA: "old_beta",
  OLD_ALPHA: "old_alpha",
} as const;

/**
 * Channel literal as it appears in version manifest entries.
 *
 * @example
 * ```ts
 * import { MinecraftChannels, type MinecraftChannel } from "@loontail/minecraft-kit";
 *
 * const isStable = (c: MinecraftChannel) => c === MinecraftChannels.RELEASE;
 * ```
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
 *
 * @example
 * ```ts
 * import { asMinecraftVersionId, type MinecraftVersionId } from "@loontail/minecraft-kit";
 *
 * const id: MinecraftVersionId = asMinecraftVersionId("1.20.1");
 * const resolved = await kit.versions.minecraft.resolve({ version: id });
 * ```
 */
export type MinecraftVersionId = string & { readonly __brand: "MinecraftVersionId" };

/**
 * One entry from the top-level Minecraft `version_manifest_v2.json` listing.
 *
 * Note: this is a summary entry, not the full per-version manifest. Use
 * {@link ResolvedMinecraft} for the resolved/parsed full manifest.
 *
 * @example
 * ```ts
 * import type { MinecraftVersionSummary } from "@loontail/minecraft-kit";
 *
 * const versions: readonly MinecraftVersionSummary[] = await kit.versions.minecraft.list();
 * const v1201 = versions.find((v) => v.id === "1.20.1");
 * console.log(v1201?.releaseTime);
 * ```
 */
export type MinecraftVersionSummary = {
  /** Version id (e.g. `"1.20.1"`). */
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
 *
 * @example
 * ```ts
 * import { asMinecraftVersionId, type MinecraftVersionManifest } from "@loontail/minecraft-kit";
 *
 * const resolved = await kit.versions.minecraft.resolve({ version: asMinecraftVersionId("1.20.1") });
 * const manifest: MinecraftVersionManifest = resolved.manifest;
 * console.log(manifest.mainClass, manifest.javaVersion?.majorVersion);
 * ```
 */
export type MinecraftVersionManifest = {
  readonly id: MinecraftVersionId;
  readonly type: MinecraftChannel | string;
  readonly mainClass: string;
  /** Asset index reference. */
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
 *
 * @example
 * ```ts
 * import type { AssetIndexReference } from "@loontail/minecraft-kit";
 *
 * const ref: AssetIndexReference = resolved.manifest.assetIndex;
 * console.log(`assets-${ref.id}.json (${ref.size} bytes, sha1 ${ref.sha1})`);
 * ```
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
 *
 * @example
 * ```ts
 * import type { MinecraftDownloads } from "@loontail/minecraft-kit";
 *
 * const downloads: MinecraftDownloads = resolved.manifest.downloads;
 * console.log(downloads.client.url, downloads.client.size);
 * ```
 */
export type MinecraftDownloads = {
  readonly client: ArtifactDownload;
  readonly server?: ArtifactDownload;
  readonly client_mappings?: ArtifactDownload;
  readonly server_mappings?: ArtifactDownload;
};

/**
 * A single hash-verified download.
 *
 * @example
 * ```ts
 * import type { ArtifactDownload } from "@loontail/minecraft-kit";
 *
 * const client: ArtifactDownload = resolved.manifest.downloads.client;
 * console.log(`client jar: ${client.url} (sha1 ${client.sha1})`);
 * ```
 */
export type ArtifactDownload = {
  readonly sha1: string;
  readonly size: number;
  readonly url: string;
};

/**
 * Library entry. Combines vanilla, modern-natives, and legacy-classifier shapes.
 *
 * @example
 * ```ts
 * import type { MinecraftLibrary } from "@loontail/minecraft-kit";
 *
 * const libs: readonly MinecraftLibrary[] = resolved.manifest.libraries;
 * const ruled = libs.filter((l) => l.rules !== undefined);
 * console.log(`${libs.length} libraries, ${ruled.length} gated by rules`);
 * ```
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
 *
 * @example
 * ```ts
 * import type { MinecraftLibraryDownloads } from "@loontail/minecraft-kit";
 *
 * const downloads: MinecraftLibraryDownloads | undefined = library.downloads;
 * if (downloads?.artifact) console.log(`primary: ${downloads.artifact.path}`);
 * ```
 */
export type MinecraftLibraryDownloads = {
  readonly artifact?: LibraryArtifact;
  readonly classifiers?: Readonly<Record<string, LibraryArtifact>>;
};

/**
 * An individual library artifact (jar/zip).
 *
 * @example
 * ```ts
 * import type { LibraryArtifact } from "@loontail/minecraft-kit";
 *
 * const lwjgl: LibraryArtifact | undefined = libraries[0]?.downloads?.artifact;
 * if (lwjgl) console.log(`${lwjgl.path} ${lwjgl.size} bytes`);
 * ```
 */
export type LibraryArtifact = ArtifactDownload & {
  readonly path: string;
};

/**
 * Rule entry used by libraries and modern arguments.
 *
 * @example
 * ```ts
 * import type { LibraryRule } from "@loontail/minecraft-kit";
 *
 * const allowOnLinux: LibraryRule = { action: "allow", os: { name: "linux" } };
 * const denyOnArm: LibraryRule = { action: "disallow", os: { arch: "aarch64" } };
 * ```
 */
export type LibraryRule = {
  readonly action: "allow" | "disallow";
  readonly os?: { readonly name?: string; readonly arch?: string; readonly version?: string };
  readonly features?: Readonly<Record<string, boolean>>;
};

/**
 * Modern (1.13+) arguments structure.
 *
 * @example
 * ```ts
 * import type { MinecraftArguments } from "@loontail/minecraft-kit";
 *
 * const args: MinecraftArguments | undefined = resolved.manifest.arguments;
 * console.log(`${args?.game.length ?? 0} game args, ${args?.jvm.length ?? 0} jvm args`);
 * ```
 */
export type MinecraftArguments = {
  readonly game: readonly ArgumentEntry[];
  readonly jvm: readonly ArgumentEntry[];
};

/**
 * A single argument entry: bare string or rule-gated value.
 *
 * @example
 * ```ts
 * import type { ArgumentEntry } from "@loontail/minecraft-kit";
 *
 * const plain: ArgumentEntry = "--username";
 * const gated: ArgumentEntry = {
 *   rules: [{ action: "allow", features: { is_demo_user: true } }],
 *   value: "--demo",
 * };
 * ```
 */
export type ArgumentEntry =
  | string
  | { readonly rules: readonly LibraryRule[]; readonly value: string | readonly string[] };

/**
 * Required Java runtime descriptor from the version manifest.
 *
 * @example
 * ```ts
 * import type { MinecraftJavaVersion } from "@loontail/minecraft-kit";
 *
 * const jv: MinecraftJavaVersion | undefined = resolved.manifest.javaVersion;
 * console.log(`needs ${jv?.component} (Java ${jv?.majorVersion}+)`);
 * ```
 */
export type MinecraftJavaVersion = {
  /** Mojang java-runtime component name (e.g. `java-runtime-gamma`). */
  readonly component: string;
  readonly majorVersion: number;
};

/**
 * Logging-config entry from the version manifest.
 *
 * @example
 * ```ts
 * import type { MinecraftLogging } from "@loontail/minecraft-kit";
 *
 * const logging: MinecraftLogging | undefined = resolved.manifest.logging;
 * console.log(logging?.client?.file.id); // → e.g. "client-1.12.xml"
 * ```
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
 *
 * @example
 * ```ts
 * import { asMinecraftVersionId, type ResolvedMinecraft } from "@loontail/minecraft-kit";
 *
 * const resolved: ResolvedMinecraft = await kit.versions.minecraft.resolve({
 *   version: asMinecraftVersionId("1.20.1"),
 * });
 * console.log(resolved.version, resolved.channel, resolved.manifest.mainClass);
 * ```
 */
export type ResolvedMinecraft = {
  /** Version id (e.g. `"1.20.1"`). */
  readonly version: MinecraftVersionId;
  readonly channel: MinecraftChannel;
  readonly manifest: MinecraftVersionManifest;
  readonly summary: MinecraftVersionSummary;
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
