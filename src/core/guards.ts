/**
 * Lightweight runtime shape checks for JSON pulled over the network. The kit ships without
 * Zod to keep the dependency surface flat; these helpers cover the "is this the shape we
 * declared, or did the server change its mind" question at the cost of a few lines per
 * endpoint. Pair with `parseJsonAs` from `./json`.
 */

import type { MojangAssetState, MojangProfileSkin, MojangSkinVariant } from "../types/auth";

const MOJANG_ASSET_STATES: ReadonlySet<MojangAssetState> = new Set(["ACTIVE", "INACTIVE"]);
const MOJANG_SKIN_VARIANTS: ReadonlySet<MojangSkinVariant> = new Set(["CLASSIC", "SLIM"]);

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
    typeof value.variant === "string" &&
    MOJANG_SKIN_VARIANTS.has(value.variant as MojangSkinVariant)
  );
};

/**
 * Light-touch guard for Mojang per-version manifests. Only checks the fields the kit
 * actually reads at the boundary; deep validation lives downstream where each field is
 * actually consumed.
 *
 * @internal
 */
export const isMinecraftVersionManifestShape = (
  value: unknown,
): value is {
  id: string;
  mainClass: string;
  assetIndex: { id: string; sha1: string; size: number; url: string };
  downloads: { client: { sha1: string; size: number; url: string } };
} => {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.mainClass)) return false;
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
