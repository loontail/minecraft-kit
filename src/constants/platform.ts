import type { Architecture, OperatingSystem } from "../types/system";

/**
 * Mapping from Node's `process.platform` to Mojang OS names.
 *
 * @internal
 */
export const NODE_PLATFORM_TO_MOJANG_OS = {
  win32: "windows",
  darwin: "osx",
  linux: "linux",
} as const satisfies Partial<Record<NodeJS.Platform, OperatingSystem>>;

/**
 * Mapping from Node's `process.arch` to Mojang/Mojang-runtime arch tags.
 *
 * @internal
 */
export const NODE_ARCH_TO_MOJANG_ARCH = {
  x64: "x64",
  ia32: "x86",
  arm64: "arm64",
} as const satisfies Partial<Record<NodeJS.Architecture, Architecture>>;

/**
 * Mapping from {OperatingSystem, Architecture} to the runtime-index platform key.
 *
 * @internal
 */
export const RUNTIME_PLATFORM_KEYS: Readonly<
  Record<OperatingSystem, Readonly<Record<Architecture, string>>>
> = {
  windows: { x64: "windows-x64", x86: "windows-x86", arm64: "windows-arm64" },
  osx: { x64: "mac-os", arm64: "mac-os-arm64", x86: "mac-os" },
  linux: { x64: "linux", x86: "linux-i386", arm64: "linux" },
};
