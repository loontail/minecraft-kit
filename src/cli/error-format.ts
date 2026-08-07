import { isMinecraftKitError, type MinecraftKitError, type MinecraftKitErrorCode } from "../index";

const formatNetworkHttpError = (e: MinecraftKitError): string => {
  const status = typeof e.context.httpStatus === "number" ? e.context.httpStatus : undefined;
  if (status === undefined) return e.message;
  if (status === 400 || status === 404)
    return "No matching data is available for that combination.";
  if (status === 408) return "The server took too long to respond. Please retry.";
  if (status === 429) return "The metadata server is rate-limiting requests. Please retry shortly.";
  if (status >= 500 && status < 600)
    return "The metadata server returned an error. Please retry later.";
  return `Unexpected HTTP ${status} from the metadata server.`;
};

const passthroughMessage = (e: MinecraftKitError): string => e.message;
const filesystemError = (e: MinecraftKitError): string => `Filesystem error: ${e.message}`;
const fixed = (text: string) => (): string => text;

const ERROR_FORMATTERS: Record<MinecraftKitErrorCode, (e: MinecraftKitError) => string> = {
  NETWORK_TIMEOUT: fixed("Network request timed out. Check your internet connection and retry."),
  NETWORK_HTTP_ERROR: formatNetworkHttpError,
  NETWORK_ABORTED: fixed("The request was aborted."),
  INTEGRITY_HASH_MISMATCH: fixed(
    "A downloaded file failed its hash check. Re-running install / repair will retry.",
  ),
  INTEGRITY_SIZE_MISMATCH: fixed(
    "A downloaded file had the wrong size. Re-running install / repair will retry.",
  ),
  MANIFEST_INVALID: fixed("The metadata server returned a malformed response. Please retry."),
  MANIFEST_NOT_FOUND: fixed("Requested item is not available — try a different selection."),
  METADATA_PARSE_ERROR: passthroughMessage,
  FILESYSTEM_PATH_TRAVERSAL: fixed(
    "An archive entry tried to escape the install directory and was rejected.",
  ),
  FILESYSTEM_WRITE_ERROR: filesystemError,
  FILESYSTEM_READ_ERROR: filesystemError,
  ARCHIVE_INVALID: passthroughMessage,
  ARCHIVE_TOO_LARGE: passthroughMessage,
  ARCHIVE_ENTRY_REJECTED: passthroughMessage,
  RUNTIME_NOT_FOUND: fixed("No runtime is published for that combination."),
  RUNTIME_UNSUPPORTED_PLATFORM: fixed("Your platform is not in Mojang's published runtime list."),
  FORGE_PROCESSOR_FAILED: fixed("A Forge processor failed during install."),
  FORGE_INSTALLER_INVALID: fixed(
    "Forge installer appears to be corrupt or in an unsupported format.",
  ),
  LAUNCH_JAVA_NOT_FOUND: fixed("Could not find a Java executable. Install the runtime first."),
  LAUNCH_PROCESS_FAILED: fixed("Minecraft exited with an error."),
  LAUNCH_ABORTED: fixed("Operation was aborted."),
  VERIFICATION_FAILED: passthroughMessage,
  INVALID_INPUT: passthroughMessage,
  NOT_IMPLEMENTED: passthroughMessage,
  UNSUPPORTED_VERSION: passthroughMessage,
  AUTH_AUTHORIZATION_CODE_DECLINED: passthroughMessage,
  AUTH_AUTHORIZATION_CODE_FAILED: passthroughMessage,
  AUTH_REFRESH_FAILED: passthroughMessage,
  AUTH_XBOX_FAILED: passthroughMessage,
  AUTH_XSTS_FAILED: passthroughMessage,
  AUTH_MINECRAFT_FAILED: passthroughMessage,
  AUTH_NO_GAME_OWNERSHIP: passthroughMessage,
  AUTH_MISSING_CLIENT_ID: passthroughMessage,
  AUTH_CANCELLED: passthroughMessage,
};

/**
 * Translate any error into a short, user-friendly sentence the CLI can show. Avoids leaking
 * raw `NETWORK_HTTP_ERROR: HTTP 400 …` strings to the operator.
 *
 * @internal
 */
export const formatUserError = (error: unknown): string => {
  if (isMinecraftKitError(error)) return ERROR_FORMATTERS[error.code](error);
  if (error instanceof Error) return error.message;
  return String(error);
};
