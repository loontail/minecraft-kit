/**
 * Stable error code registry. `MinecraftKitError` carries one of these as `code`; consumers
 * can switch on it exhaustively via the derived {@link MinecraftKitErrorCode} union.
 *
 * Codes are stable across releases — adding new codes is non-breaking; removing or renaming
 * a code is a breaking change.
 *
 * @example
 * ```ts
 * import { isMinecraftKitError, MinecraftKitErrorCodes } from "@loontail/minecraft-kit";
 *
 * if (isMinecraftKitError(e) && e.code === MinecraftKitErrorCodes.NETWORK_TIMEOUT) {
 *   await scheduleRetry();
 * }
 * ```
 */
export const MinecraftKitErrorCodes = {
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  NETWORK_HTTP_ERROR: "NETWORK_HTTP_ERROR",
  NETWORK_ABORTED: "NETWORK_ABORTED",
  INTEGRITY_HASH_MISMATCH: "INTEGRITY_HASH_MISMATCH",
  INTEGRITY_SIZE_MISMATCH: "INTEGRITY_SIZE_MISMATCH",
  MANIFEST_INVALID: "MANIFEST_INVALID",
  MANIFEST_NOT_FOUND: "MANIFEST_NOT_FOUND",
  METADATA_PARSE_ERROR: "METADATA_PARSE_ERROR",
  FILESYSTEM_PATH_TRAVERSAL: "FILESYSTEM_PATH_TRAVERSAL",
  FILESYSTEM_WRITE_ERROR: "FILESYSTEM_WRITE_ERROR",
  FILESYSTEM_READ_ERROR: "FILESYSTEM_READ_ERROR",
  ARCHIVE_INVALID: "ARCHIVE_INVALID",
  ARCHIVE_TOO_LARGE: "ARCHIVE_TOO_LARGE",
  ARCHIVE_ENTRY_REJECTED: "ARCHIVE_ENTRY_REJECTED",
  RUNTIME_NOT_FOUND: "RUNTIME_NOT_FOUND",
  RUNTIME_UNSUPPORTED_PLATFORM: "RUNTIME_UNSUPPORTED_PLATFORM",
  FORGE_PROCESSOR_FAILED: "FORGE_PROCESSOR_FAILED",
  FORGE_INSTALLER_INVALID: "FORGE_INSTALLER_INVALID",
  LAUNCH_JAVA_NOT_FOUND: "LAUNCH_JAVA_NOT_FOUND",
  LAUNCH_PROCESS_FAILED: "LAUNCH_PROCESS_FAILED",
  LAUNCH_ABORTED: "LAUNCH_ABORTED",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  INVALID_INPUT: "INVALID_INPUT",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  UNSUPPORTED_VERSION: "UNSUPPORTED_VERSION",
  AUTH_AUTHORIZATION_CODE_DECLINED: "AUTH_AUTHORIZATION_CODE_DECLINED",
  AUTH_AUTHORIZATION_CODE_FAILED: "AUTH_AUTHORIZATION_CODE_FAILED",
  AUTH_REFRESH_FAILED: "AUTH_REFRESH_FAILED",
  AUTH_XBOX_FAILED: "AUTH_XBOX_FAILED",
  AUTH_XSTS_FAILED: "AUTH_XSTS_FAILED",
  AUTH_MINECRAFT_FAILED: "AUTH_MINECRAFT_FAILED",
  AUTH_NO_GAME_OWNERSHIP: "AUTH_NO_GAME_OWNERSHIP",
  AUTH_MISSING_CLIENT_ID: "AUTH_MISSING_CLIENT_ID",
  AUTH_CANCELLED: "AUTH_CANCELLED",
} as const;

/**
 * Union of every value in {@link MinecraftKitErrorCodes}. Use as the key type when building
 * exhaustive lookup tables that translate kit codes to a consumer-facing taxonomy.
 *
 * @example
 * ```ts
 * import { type MinecraftKitErrorCode, MinecraftKitErrorCodes } from "@loontail/minecraft-kit";
 *
 * type LauncherErrorCode = "NETWORK" | "INTEGRITY" | "RUNTIME";
 *
 * const KIT_TO_LAUNCHER: Partial<Record<MinecraftKitErrorCode, LauncherErrorCode>> = {
 *   [MinecraftKitErrorCodes.NETWORK_TIMEOUT]: "NETWORK",
 *   [MinecraftKitErrorCodes.NETWORK_HTTP_ERROR]: "NETWORK",
 *   [MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH]: "INTEGRITY",
 *   [MinecraftKitErrorCodes.RUNTIME_NOT_FOUND]: "RUNTIME",
 * };
 * ```
 */
export type MinecraftKitErrorCode =
  (typeof MinecraftKitErrorCodes)[keyof typeof MinecraftKitErrorCodes];

/**
 * Structured context attached to errors. Always safe to serialize via `JSON.stringify`.
 *
 * @example
 * ```ts
 * if (isMinecraftKitError(e)) {
 *   const ctx: MinecraftKitErrorContext = e.context;
 *   logger.error("install failed", { code: e.code, url: ctx.url, status: ctx.httpStatus });
 * }
 * ```
 */
export type MinecraftKitErrorContext = {
  readonly url?: string;
  readonly filePath?: string;
  readonly expectedHash?: string;
  readonly actualHash?: string;
  readonly expectedSize?: number;
  readonly actualSize?: number;
  readonly httpStatus?: number;
  readonly exitCode?: number;
  readonly platform?: string;
  readonly version?: string;
  readonly [key: string]: unknown;
};
