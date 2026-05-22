/**
 * All `${...}` tokens substituted into JVM and game arguments.
 *
 * This map drives both substitution at launch time and documentation generation.
 *
 * @internal
 */
export const LAUNCH_PLACEHOLDERS = {
  "${auth_player_name}": "Player display name.",
  "${version_name}": "Resolved Minecraft version id.",
  "${game_directory}": "Per-target directory.",
  "${assets_root}": "Assets root (`<directory>/assets`).",
  "${assets_index_name}": "Asset index id from the manifest.",
  "${auth_uuid}": "Player UUID (no dashes).",
  "${auth_access_token}": "Yggdrasil/MSA access token.",
  "${auth_session}": "Legacy session token (`token:<token>:<uuid>`).",
  "${clientid}": "MSA client id.",
  "${auth_xuid}": "Xbox user id.",
  "${user_type}": "`msa` | `mojang` | `legacy`.",
  "${user_properties}": "User properties JSON (often `{}`).",
  "${version_type}": "Channel string, e.g. `release`.",
  "${game_assets}": "Legacy virtual assets directory.",
  "${resolution_width}": "Window width (feature-gated).",
  "${resolution_height}": "Window height (feature-gated).",
  "${natives_directory}": "Extracted natives directory.",
  "${classpath}": "Joined classpath of libraries + version jar.",
  "${classpath_separator}": "OS-specific classpath separator (`:` / `;`).",
  "${library_directory}": "Per-target libraries directory.",
  "${launcher_name}": "Launcher brand string.",
  "${launcher_version}": "Launcher version string.",
  "${path}": "Path to the log4j config file (logging.client.argument only).",
} as const;

/**
 * Token literal type.
 *
 * @internal
 */
export type LaunchPlaceholder = keyof typeof LAUNCH_PLACEHOLDERS;
