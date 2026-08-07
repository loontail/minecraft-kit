/**
 * Relative-path segments used to build per-target directory layouts.
 *
 * These are SEGMENTS — never use them as absolute paths. Compose with `path.join` at call sites.
 *
 * @internal
 */
export const VERSIONS_DIR = "versions";
/** @internal */
export const LIBRARIES_DIR = "libraries";
/** @internal */
export const ASSETS_DIR = "assets";
/** @internal */
export const ASSETS_OBJECTS_DIR = "assets/objects";
/** @internal */
export const ASSETS_INDEXES_DIR = "assets/indexes";
/** @internal */
export const ASSETS_VIRTUAL_DIR = "assets/virtual";
/** @internal */
export const ASSETS_LEGACY_DIR = "assets/virtual/legacy";
/** @internal */
export const ASSETS_RESOURCES_DIR = "resources";
/** @internal */
export const ASSETS_LOG_CONFIGS_DIR = "assets/log_configs";
/** @internal */
export const RUNTIMES_DIR = "runtime";
/** @internal */
export const NATIVES_DIR_NAME = "natives";
/** @internal */
export const FORGE_INSTALLERS_DIR = "forge-installers";

/**
 * Filename pattern for Forge installer JARs cached under {@link FORGE_INSTALLERS_DIR}.
 * `${mavenVersion}` is the Maven version identifier (e.g. `1.20.1-47.2.0`).
 *
 * @internal
 */
export const forgeInstallerFilename = (mavenVersion: string): string =>
  `forge-${mavenVersion}-installer.jar`;

/**
 * Java executable filename per OS (relative to the runtime root).
 *
 * @internal
 */
export const JAVA_EXECUTABLE = {
  windows: "bin/javaw.exe",
  linux: "bin/java",
  /** Note: macOS uses an extra `jre.bundle/Contents/Home/` prefix above this. */
  osx: "bin/java",
} as const;

/**
 * macOS runtime layout adds this prefix above {@link JAVA_EXECUTABLE.osx}.
 *
 * @internal
 */
export const MAC_RUNTIME_PREFIX = "jre.bundle/Contents/Home";
