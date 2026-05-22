/**
 * Operating-system identifiers used by Mojang launcher metadata.
 *
 * Mojang manifests use `windows`, `osx`, and `linux` as canonical names. These differ
 * from Node's {@link NodeJS.Platform} values (`win32` / `darwin` / `linux`).
 *
 * @example
 * ```ts
 * import { OperatingSystems } from "@loontail/minecraft-kit";
 *
 * if (system.os === OperatingSystems.OSX) console.log("running on macOS");
 * ```
 */
export const OperatingSystems = {
  WINDOWS: "windows",
  OSX: "osx",
  LINUX: "linux",
} as const;

/**
 * OS literal as used inside Mojang/Forge/Fabric JSON manifests.
 *
 * @example
 * ```ts
 * import { OperatingSystems, type OperatingSystem } from "@loontail/minecraft-kit";
 *
 * const jvmFlagsFor = (os: OperatingSystem): readonly string[] =>
 *   os === OperatingSystems.OSX ? ["-XstartOnFirstThread"] : [];
 * ```
 */
export type OperatingSystem = (typeof OperatingSystems)[keyof typeof OperatingSystems];

/**
 * CPU architecture identifiers. Matches the values that appear in Mojang library `os.arch`
 * fields, after normalization from Node's {@link NodeJS.Architecture}.
 *
 * @example
 * ```ts
 * import { Architectures } from "@loontail/minecraft-kit";
 *
 * const isModern = system.arch === Architectures.ARM64 || system.arch === Architectures.X64;
 * ```
 */
export const Architectures = {
  X86: "x86",
  X64: "x64",
  ARM64: "arm64",
} as const;

/**
 * Architecture literal used in launcher metadata.
 *
 * @example
 * ```ts
 * import { Architectures, type Architecture } from "@loontail/minecraft-kit";
 *
 * const nativesClassifier = (arch: Architecture): string =>
 *   arch === Architectures.ARM64 ? "natives-arm64" : "natives";
 * ```
 */
export type Architecture = (typeof Architectures)[keyof typeof Architectures];

/**
 * Identifies the host system for the launcher. All resolvers consume this object to
 * pick the right artifacts (libraries, natives, runtime).
 *
 * @example
 * ```ts
 * import { detectSystem, type RuntimeSystem } from "@loontail/minecraft-kit";
 *
 * const system: RuntimeSystem = detectSystem();
 * console.log(`host: ${system.os}/${system.arch} (release ${system.osVersion})`);
 * ```
 */
export type RuntimeSystem = {
  /** OS identifier (mojang naming). */
  readonly os: OperatingSystem;
  /** CPU architecture (mojang naming). */
  readonly arch: Architecture;
  /** OS version string from `os.release()`. Used to evaluate library `os.version` regex rules. */
  readonly osVersion: string;
};
