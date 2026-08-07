/**
 * Operating-system identifiers used by Mojang launcher metadata.
 *
 * Mojang manifests use `windows`, `osx`, and `linux` as canonical names. These differ
 * from Node's {@link NodeJS.Platform} values (`win32` / `darwin` / `linux`).
 */
export const OperatingSystems = {
  WINDOWS: "windows",
  OSX: "osx",
  LINUX: "linux",
} as const;

/**
 * OS literal as used inside Mojang/Forge/Fabric JSON manifests.
 */
export type OperatingSystem = (typeof OperatingSystems)[keyof typeof OperatingSystems];

/**
 * CPU architecture identifiers. Matches the values that appear in Mojang library `os.arch`
 * fields, after normalization from Node's {@link NodeJS.Architecture}.
 */
export const Architectures = {
  X86: "x86",
  X64: "x64",
  ARM64: "arm64",
} as const;

/**
 * Architecture literal used in launcher metadata.
 */
export type Architecture = (typeof Architectures)[keyof typeof Architectures];

/**
 * Identifies the host system for the launcher. All resolvers consume this object to
 * pick the right artifacts (libraries, natives, runtime).
 */
export type RuntimeSystem = {
  /** OS identifier (mojang naming). */
  readonly os: OperatingSystem;
  /** CPU architecture (mojang naming). */
  readonly arch: Architecture;
  /** OS version string from `os.release()`. Used to evaluate library `os.version` regex rules. */
  readonly osVersion: string;
};
