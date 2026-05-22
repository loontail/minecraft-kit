import crypto from "node:crypto";

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
export const offlineUuidFor = (username: string): string => {
  const md5 = crypto.createHash("md5");
  md5.update(`OfflinePlayer:${username}`, "utf8");
  const bytes = md5.digest();
  bytes[6] = patchVersionV3(bytes[6] ?? 0);
  bytes[8] = patchVariantRfc4122(bytes[8] ?? 0);
  return formatUuid(bytes);
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
