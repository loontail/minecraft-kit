/**
 * Lightweight runtime shape checks for JSON pulled over the network. The kit ships without
 * Zod to keep the dependency surface flat; these helpers cover the "is this the shape we
 * declared, or did the server change its mind" question at the cost of a few lines per
 * endpoint. Pair with `parseJsonAs` from `./json`.
 */

import {
  type MojangAssetState,
  MojangAssetStates,
  type MojangProfileSkin,
  type SkinVariant,
  SkinVariants,
} from "../types/auth";
import type { FabricProfile } from "../types/fabric";
import type {
  AssetIndexDocument,
  MinecraftVersionManifest,
  VersionManifestRoot,
} from "../types/minecraft";
import { RuntimeEntryTypes, type RuntimeFilesManifest, type RuntimeIndex } from "../types/runtime";

const MOJANG_ASSET_STATES: ReadonlySet<MojangAssetState> = new Set(
  Object.values(MojangAssetStates),
);
const MOJANG_SKIN_VARIANTS: ReadonlySet<SkinVariant> = new Set(Object.values(SkinVariants));

/**
 * True when `value` is a non-null object.
 *
 * @internal
 */
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

/**
 * True when `value` is a non-empty string.
 *
 * @internal
 */
export const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === "string" && value.length > 0;
};

/**
 * True when `value` is a finite non-negative integer (size / count / etc.).
 *
 * @internal
 */
export const isNonNegativeInteger = (value: unknown): value is number => {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
};

/**
 * True when `value` is an array and every element passes `itemGuard`.
 *
 * @internal
 */
export const isArrayOf = <T>(
  value: unknown,
  itemGuard: (item: unknown) => item is T,
): value is readonly T[] => {
  return Array.isArray(value) && value.every(itemGuard);
};

/**
 * True when `value` is a 40-character lower-case hex SHA-1 digest.
 *
 * @internal
 */
export const isSha1Hex = (value: unknown): value is string => {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
};

/**
 * True when `value` looks like a `{ sha1, size, url }` artifact entry. We don't enforce
 * `isSha1Hex(sha1)` here because some legacy / old-alpha manifests ship non-hex placeholder
 * strings — the boundary check is about "shape is right", not "values are well-formed".
 * Hash integrity is verified later at the download site.
 *
 * @internal
 */
export const isArtifactDownload = (
  value: unknown,
): value is { sha1: string; size: number; url: string } => {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.sha1 === "string" && typeof value.size === "number" && isNonEmptyString(value.url)
  );
};

/**
 * True when `value` matches the shape of a single skin slot from
 * `/minecraft/profile`. Rejects rows with missing required fields and rows
 * whose `state` / `variant` carry values outside the declared unions — those
 * are surfaced as "drop the row" rather than corrupting downstream union
 * narrowing.
 *
 * @internal
 */
export const isMojangProfileSkin = (value: unknown): value is MojangProfileSkin => {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.url)) return false;
  if (
    typeof value.state !== "string" ||
    !MOJANG_ASSET_STATES.has(value.state as MojangAssetState)
  ) {
    return false;
  }
  return (
    typeof value.variant === "string" && MOJANG_SKIN_VARIANTS.has(value.variant as SkinVariant)
  );
};

/**
 * Light-touch guard for Mojang per-version manifests.
 *
 * @remarks
 * Verifies every field the kit dereferences without a further check: `id`,
 * `mainClass`, `assetIndex`, `downloads.client`, and `libraries` (the install
 * planner and the verifier both iterate it unguarded). Genuinely optional
 * fields (`arguments`, `javaVersion`, `inheritsFrom`, `logging`, …) are guarded
 * at their own use sites. The predicate widens to
 * {@link MinecraftVersionManifest} so call sites do not need an
 * `as unknown as` cast; the widening is a type-system trade-off, not a runtime
 * guarantee.
 *
 * @internal
 */
export const isMinecraftVersionManifestShape = (
  value: unknown,
): value is MinecraftVersionManifest => {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.mainClass)) return false;
  if (!Array.isArray(value.libraries)) return false;
  if (!isPlainObject(value.assetIndex)) return false;
  if (
    !isNonEmptyString(value.assetIndex.id) ||
    typeof value.assetIndex.sha1 !== "string" ||
    typeof value.assetIndex.size !== "number" ||
    !isNonEmptyString(value.assetIndex.url)
  ) {
    return false;
  }
  if (!isPlainObject(value.downloads)) return false;
  return isArtifactDownload((value.downloads as Record<string, unknown>).client);
};

/**
 * Light-touch guard for `version_manifest_v2.json`. Checks `latest.release`,
 * `latest.snapshot`, and every entry of `versions[]` for the four fields the
 * resolver actually reads (`id`, `type`, `url`, `sha1`).
 *
 * @internal
 */
export const isVersionManifestRootShape = (value: unknown): value is VersionManifestRoot => {
  if (!isPlainObject(value)) return false;
  if (!isPlainObject(value.latest)) return false;
  if (!isNonEmptyString(value.latest.release) || !isNonEmptyString(value.latest.snapshot)) {
    return false;
  }
  if (!Array.isArray(value.versions)) return false;
  for (const summary of value.versions) {
    if (!isPlainObject(summary)) return false;
    if (
      !isNonEmptyString(summary.id) ||
      !isNonEmptyString(summary.type) ||
      !isNonEmptyString(summary.url) ||
      typeof summary.sha1 !== "string"
    ) {
      return false;
    }
  }
  return true;
};

/**
 * Light-touch guard for Mojang asset index documents. Requires `objects` and
 * that every entry carries `{ hash: string, size: number }`.
 *
 * @internal
 */
export const isAssetIndexShape = (value: unknown): value is AssetIndexDocument => {
  if (!isPlainObject(value)) return false;
  if (!isPlainObject(value.objects)) return false;
  for (const entry of Object.values(value.objects)) {
    if (!isPlainObject(entry)) return false;
    if (typeof entry.hash !== "string" || typeof entry.size !== "number") return false;
  }
  return true;
};

/**
 * Light-touch guard for `https://launchermeta.mojang.com/.../all.json`. The
 * top level is a map of platform key → component map → array of release
 * entries; an empty platform or empty component is legal. Each entry needs
 * `manifest.url` (used to fetch the per-component file manifest) and
 * `version.released` (used to pick the newest under `LATEST` preference).
 *
 * @internal
 */
export const isMojangJavaRuntimesShape = (value: unknown): value is RuntimeIndex => {
  if (!isPlainObject(value)) return false;
  for (const platform of Object.values(value)) {
    if (!isPlainObject(platform)) return false;
    for (const items of Object.values(platform)) {
      if (!Array.isArray(items)) return false;
      for (const entry of items) {
        if (!isRuntimeIndexEntryShape(entry)) return false;
      }
    }
  }
  return true;
};

const isRuntimeIndexEntryShape = (value: unknown): boolean => {
  if (!isPlainObject(value)) return false;
  if (!isPlainObject(value.manifest)) return false;
  if (!isNonEmptyString(value.manifest.url)) return false;
  if (typeof value.manifest.sha1 !== "string") return false;
  if (!isPlainObject(value.version)) return false;
  return isNonEmptyString(value.version.name) && typeof value.version.released === "string";
};

/**
 * Light-touch guard for the per-component runtime files manifest. Requires
 * `files` to be an object whose values each carry a string `type` discriminator
 * (`"file" | "directory" | "link"`) plus the payload that discriminant implies:
 * `downloads.raw` for `file` entries, `target` for `link` entries. A `directory`
 * entry legitimately carries neither, and an empty `files` map is legal.
 *
 * The per-variant checks are not optional politeness: the install planner and the
 * verifier both reach straight into `entry.downloads.raw.url` / `entry.target`
 * with no further guard, so a manifest that passed a `type`-only check would fail
 * as a raw `TypeError` instead of `MANIFEST_INVALID`.
 *
 * @internal
 */
export const isJavaRuntimeManifestShape = (value: unknown): value is RuntimeFilesManifest => {
  if (!isPlainObject(value)) return false;
  if (!isPlainObject(value.files)) return false;
  for (const entry of Object.values(value.files)) {
    if (!isPlainObject(entry)) return false;
    if (typeof entry.type !== "string") return false;
    if (entry.type === RuntimeEntryTypes.FILE) {
      if (!isPlainObject(entry.downloads)) return false;
      if (!isArtifactDownload(entry.downloads.raw)) return false;
    }
    if (entry.type === RuntimeEntryTypes.LINK && !isNonEmptyString(entry.target)) return false;
  }
  return true;
};

/**
 * Light-touch guard for Fabric profile JSON
 * (`/v2/versions/loader/{mc}/{loader}/profile/json`). Checks the four fields
 * the install planner reads (`id`, `inheritsFrom`, `mainClass`, `libraries[]`)
 * and that every library carries a `name` string.
 *
 * @internal
 */
export const isFabricProfileShape = (value: unknown): value is FabricProfile => {
  if (!isPlainObject(value)) return false;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.inheritsFrom) ||
    !isNonEmptyString(value.mainClass)
  ) {
    return false;
  }
  if (!Array.isArray(value.libraries)) return false;
  for (const lib of value.libraries) {
    if (!isPlainObject(lib) || !isNonEmptyString(lib.name)) return false;
  }
  return true;
};
