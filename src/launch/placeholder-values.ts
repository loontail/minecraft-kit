import { DEFAULT_LAUNCHER_NAME, DEFAULT_LAUNCHER_VERSION } from "../constants/defaults";
import { targetPaths } from "../core/paths";
import { offlineUuidFor, stripUuidDashes } from "../core/uuid";
import { AuthModes, type LaunchAuth } from "../types/auth";
import type { LaunchOptions } from "../types/launch";
import type { Target } from "../types/target";

/**
 * Resolve every `${...}` value the launch arguments substitute against.
 *
 * @internal
 */
export const buildPlaceholderValues = (input: {
  readonly target: Target;
  readonly versionId: string;
  readonly auth: LaunchAuth;
  readonly classpath: readonly string[];
  readonly options: LaunchOptions;
}): Readonly<Record<string, string>> => {
  const cpSeparator = process.platform === "win32" ? ";" : ":";
  const directory = input.target.directory;
  const username = input.auth.username;
  const uuid =
    input.auth.mode === AuthModes.OFFLINE
      ? (input.auth.uuid ?? offlineUuidFor(username))
      : input.auth.uuid;
  const accessToken = input.auth.mode === AuthModes.OFFLINE ? "0" : input.auth.accessToken;
  const userType = input.auth.mode === AuthModes.OFFLINE ? "legacy" : input.auth.userType;
  const launcherName = input.options.launcherName ?? DEFAULT_LAUNCHER_NAME;
  const launcherVersion = input.options.launcherVersion ?? DEFAULT_LAUNCHER_VERSION;
  return {
    auth_player_name: username,
    version_name: input.versionId,
    game_directory: directory,
    assets_root: targetPaths.assetsDir(directory),
    assets_index_name: input.target.minecraft.manifest.assets,
    auth_uuid: stripUuidDashes(uuid),
    auth_access_token: accessToken,
    auth_session: `token:${accessToken}:${stripUuidDashes(uuid)}`,
    clientid: input.auth.mode === AuthModes.ONLINE ? (input.auth.clientId ?? "") : "",
    auth_xuid: input.auth.mode === AuthModes.ONLINE ? (input.auth.xuid ?? "") : "",
    user_type: userType,
    user_properties: "{}",
    version_type: input.target.minecraft.channel,
    game_assets: targetPaths.assetsLegacyDir(directory),
    natives_directory: targetPaths.nativesDir(directory, input.target.minecraft.version),
    classpath: input.classpath.join(cpSeparator),
    classpath_separator: cpSeparator,
    library_directory: targetPaths.librariesDir(directory),
    launcher_name: launcherName,
    launcher_version: launcherVersion,
    resolution_width: input.options.resolution?.width.toString() ?? "",
    resolution_height: input.options.resolution?.height.toString() ?? "",
  };
};
