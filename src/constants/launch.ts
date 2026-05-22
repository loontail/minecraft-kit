/**
 * JVM args appended for every launch.
 *
 * @internal
 */
export const BASE_JVM_ARGS = [
  "-XX:+UnlockExperimentalVMOptions",
  "-XX:+UseG1GC",
  "-XX:G1NewSizePercent=20",
  "-XX:G1ReservePercent=20",
  "-XX:MaxGCPauseMillis=50",
  "-XX:G1HeapRegionSize=32M",
] as const;

/**
 * JVM args added for legacy (≤1.12) versions that lack `arguments.jvm`.
 *
 * @internal
 */
export const LEGACY_JVM_ARGS = [
  "-Djava.library.path=${natives_directory}",
  "-Dminecraft.launcher.brand=${launcher_name}",
  "-Dminecraft.launcher.version=${launcher_version}",
  "-cp",
  "${classpath}",
] as const;

/**
 * macOS-only JVM args (suppress dock label).
 *
 * @internal
 */
export const MACOS_JVM_ARGS = ["-Xdock:name=Minecraft"] as const;
