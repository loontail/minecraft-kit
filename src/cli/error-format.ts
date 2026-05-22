import { isMinecraftKitError } from "../core/errors";

/**
 * Translate any error into a short, user-friendly sentence the CLI can show. Avoids leaking
 * raw `NETWORK_HTTP_ERROR: HTTP 400 …` strings to the operator.
 *
 * @internal
 */
export const formatUserError = (error: unknown): string => {
  if (isMinecraftKitError(error)) {
    const status =
      typeof error.context.httpStatus === "number" ? error.context.httpStatus : undefined;
    if (error.code === "NETWORK_HTTP_ERROR" && status !== undefined) {
      if (status === 400 || status === 404) {
        return "No matching data is available for that combination.";
      }
      if (status === 408) return "The server took too long to respond. Please retry.";
      if (status === 429)
        return "The metadata server is rate-limiting requests. Please retry shortly.";
      if (status >= 500 && status < 600) {
        return "The metadata server returned an error. Please retry later.";
      }
      return `Unexpected HTTP ${status} from the metadata server.`;
    }
    switch (error.code) {
      case "NETWORK_TIMEOUT":
        return "Network request timed out. Check your internet connection and retry.";
      case "NETWORK_ABORTED":
        return "The request was aborted.";
      case "MANIFEST_NOT_FOUND":
        return "Requested item is not available — try a different selection.";
      case "MANIFEST_INVALID":
        return "The metadata server returned a malformed response. Please retry.";
      case "INTEGRITY_HASH_MISMATCH":
        return "A downloaded file failed its hash check. Re-running install / repair will retry.";
      case "INTEGRITY_SIZE_MISMATCH":
        return "A downloaded file had the wrong size. Re-running install / repair will retry.";
      case "RUNTIME_NOT_FOUND":
        return "No runtime is published for that combination.";
      case "RUNTIME_UNSUPPORTED_PLATFORM":
        return "Your platform is not in Mojang's published runtime list.";
      case "FORGE_INSTALLER_INVALID":
        return "Forge installer appears to be corrupt or in an unsupported format.";
      case "FORGE_PROCESSOR_FAILED":
        return "A Forge processor failed during install.";
      case "LAUNCH_JAVA_NOT_FOUND":
        return "Could not find a Java executable. Install the runtime first.";
      case "LAUNCH_PROCESS_FAILED":
        return "Minecraft exited with an error.";
      case "LAUNCH_ABORTED":
        return "Operation was aborted.";
      case "INVALID_INPUT":
        return error.message;
      case "FILESYSTEM_PATH_TRAVERSAL":
        return "An archive entry tried to escape the install directory and was rejected.";
      case "FILESYSTEM_WRITE_ERROR":
      case "FILESYSTEM_READ_ERROR":
        return `Filesystem error: ${error.message}`;
      case "AUTH_MISSING_CLIENT_ID":
      case "AUTH_AUTHORIZATION_CODE_DECLINED":
      case "AUTH_AUTHORIZATION_CODE_FAILED":
      case "AUTH_NO_GAME_OWNERSHIP":
      case "AUTH_XBOX_FAILED":
      case "AUTH_XSTS_FAILED":
      case "AUTH_MINECRAFT_FAILED":
      case "AUTH_REFRESH_FAILED":
      case "AUTH_CANCELLED":
        return error.message;
      default:
        return error.message;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
};
