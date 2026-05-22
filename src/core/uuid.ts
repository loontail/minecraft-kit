import crypto from "node:crypto";
import type { PlayerUuid } from "../types/auth";
import { MinecraftKitError, MinecraftKitErrorCodes } from "./errors";

/**
 * Validate `raw` as a Minecraft player UUID and brand it as {@link PlayerUuid}.
 * Throws `MinecraftKitError(INVALID_INPUT)` when the input is empty after
 * trimming. The constructor does not enforce a specific UUID shape — Mojang
 * accepts both dashed and undashed forms in different APIs — but it does
 * reject the empty string so a missing storage entry can't quietly become a
 * UUID-shaped placeholder.
 *
 * @example
 * ```ts
 * import { asPlayerUuid } from "@loontail/minecraft-kit";
 *
 * const uuid = asPlayerUuid(await storage.load("player-uuid"));
 * ```
 */
export const asPlayerUuid = (raw: string): PlayerUuid => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      "Player UUID cannot be empty.",
    );
  }
  return trimmed as PlayerUuid;
};

/**
 * Derive a stable v3-style UUID for an offline player username.
 *
 * Mojang's offline-mode formula: `MD5("OfflinePlayer:" + name)` with the version/variant
 * bits patched to UUID v3.
 *
 * @example
 * ```ts
 * import { AuthModes, offlineUuidFor, type OfflineAuth } from "@loontail/minecraft-kit";
 *
 * const username = "Notch";
 * const auth: OfflineAuth = { mode: AuthModes.OFFLINE, username, uuid: offlineUuidFor(username) };
 * // auth.uuid → "069a79f4-44e9-4726-a5be-fca90e38aaf5"
 * ```
 */
export const offlineUuidFor = (username: string): PlayerUuid => {
  const md5 = crypto.createHash("md5");
  md5.update(`OfflinePlayer:${username}`, "utf8");
  const bytes = md5.digest();
  bytes[6] = patchVersionV3(bytes[6] ?? 0);
  bytes[8] = patchVariantRfc4122(bytes[8] ?? 0);
  return formatUuid(bytes) as PlayerUuid;
};

const patchVersionV3 = (byte: number): number => (byte & 0x0f) | 0x30;
const patchVariantRfc4122 = (byte: number): number => (byte & 0x3f) | 0x80;

const formatUuid = (bytes: Buffer): string => {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

/**
 * Strip the dashes from a UUID. Used by `${auth_uuid}`.
 *
 * @example
 * ```ts
 * import { stripUuidDashes } from "@loontail/minecraft-kit";
 *
 * stripUuidDashes("069a79f4-44e9-4726-a5be-fca90e38aaf5");
 * // → "069a79f444e94726a5befca90e38aaf5"
 * ```
 */
export const stripUuidDashes = (uuid: string): string => {
  return uuid.replaceAll("-", "");
};

/**
 * Insert the canonical 8-4-4-4-12 dashes into a 32-char hex UUID. Inverse of
 * {@link stripUuidDashes}. Returns the input unchanged if it already contains
 * a `-` or is not 32 characters — the caller is expected to recover from
 * malformed input downstream.
 *
 * @example
 * ```ts
 * import { addUuidDashes } from "@loontail/minecraft-kit";
 *
 * addUuidDashes("069a79f444e94726a5befca90e38aaf5");
 * // → "069a79f4-44e9-4726-a5be-fca90e38aaf5"
 * ```
 *
 * @internal
 */
export const addUuidDashes = (raw: string): string => {
  if (raw.includes("-")) return raw;
  if (raw.length !== 32) return raw;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
};
