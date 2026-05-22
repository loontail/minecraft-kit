import path from "node:path";
import {
  ASSETS_DIR,
  ASSETS_INDEXES_DIR,
  ASSETS_LEGACY_DIR,
  ASSETS_LOG_CONFIGS_DIR,
  ASSETS_OBJECTS_DIR,
  ASSETS_RESOURCES_DIR,
  ASSETS_VIRTUAL_DIR,
  FORGE_INSTALLERS_DIR,
  JAVA_EXECUTABLE,
  LIBRARIES_DIR,
  MAC_RUNTIME_PREFIX,
  NATIVES_DIR_NAME,
  RUNTIMES_DIR,
  VERSIONS_DIR,
  forgeInstallerFilename,
} from "../constants/files";
import type { OperatingSystem } from "../types/system";

/**
 * Helpers for the per-target Minecraft directory layout. Use these to derive paths to a
 * specific file (`versions/<id>/<id>.jar`, `assets/objects/<aa>/<sha1>`, …) consistently with
 * what the install and verify runners write/expect.
 *
 * @example
 * ```ts
 * import { targetPaths } from "@loontail/minecraft-kit";
 *
 * const jar = targetPaths.versionJar(target.directory, target.minecraft.version);
 * const java = targetPaths.runtimeJavaExecutable(
 *   target.directory,
 *   target.runtime.component,
 *   target.runtime.system.os,
 *   target.runtime.installRoot,
 * );
 * ```
 */
export const targetPaths = {
  versionsDir: (root: string): string => path.join(root, VERSIONS_DIR),
  versionDir: (root: string, versionId: string): string => path.join(root, VERSIONS_DIR, versionId),
  versionJar: (root: string, versionId: string): string =>
    path.join(root, VERSIONS_DIR, versionId, `${versionId}.jar`),
  versionJson: (root: string, versionId: string): string =>
    path.join(root, VERSIONS_DIR, versionId, `${versionId}.json`),
  librariesDir: (root: string): string => path.join(root, LIBRARIES_DIR),
  assetsDir: (root: string): string => path.join(root, ASSETS_DIR),
  assetsLegacyDir: (root: string): string => path.join(root, ASSETS_LEGACY_DIR),
  runtimesDir: (root: string): string => path.join(root, RUNTIMES_DIR),
  libraryFile: (root: string, libraryPath: string): string =>
    path.join(root, LIBRARIES_DIR, libraryPath),
  assetIndex: (root: string, indexId: string): string =>
    path.join(root, ASSETS_INDEXES_DIR, `${indexId}.json`),
  assetObject: (root: string, hash: string): string =>
    path.join(root, ASSETS_OBJECTS_DIR, hash.slice(0, 2), hash),
  assetVirtual: (root: string, virtualPath: string): string =>
    path.join(root, ASSETS_VIRTUAL_DIR, virtualPath),
  assetLegacy: (root: string, virtualPath: string): string =>
    path.join(root, ASSETS_LEGACY_DIR, virtualPath),
  assetResource: (root: string, virtualPath: string): string =>
    path.join(root, ASSETS_RESOURCES_DIR, virtualPath),
  loggingConfig: (root: string, id: string): string => path.join(root, ASSETS_LOG_CONFIGS_DIR, id),
  nativesDir: (root: string, versionId: string): string =>
    path.join(root, VERSIONS_DIR, versionId, NATIVES_DIR_NAME),
  /**
   * Path to a runtime component's root directory. Honours `installRoot` (custom global
   * runtime location) when present; otherwise falls back to `<directory>/runtime/<component>`.
   */
  runtimeRoot: (directory: string, component: string, installRoot?: string): string =>
    installRoot !== undefined
      ? path.join(installRoot, component)
      : path.join(directory, RUNTIMES_DIR, component),
  runtimeJavaExecutable: (
    directory: string,
    component: string,
    os: OperatingSystem,
    installRoot?: string,
  ): string => {
    const runtime = targetPaths.runtimeRoot(directory, component, installRoot);
    if (os === "windows") return path.join(runtime, JAVA_EXECUTABLE.windows);
    if (os === "osx") return path.join(runtime, MAC_RUNTIME_PREFIX, JAVA_EXECUTABLE.osx);
    return path.join(runtime, JAVA_EXECUTABLE.linux);
  },
  forgeInstaller: (root: string, mavenVersion: string): string =>
    path.join(root, FORGE_INSTALLERS_DIR, forgeInstallerFilename(mavenVersion)),
} as const;
