import os from "node:os";
import { NODE_ARCH_TO_MOJANG_ARCH, NODE_PLATFORM_TO_MOJANG_OS } from "../constants/platform";
import type { Architecture, OperatingSystem, RuntimeSystem } from "../types/system";
import { MinecraftKitError, MinecraftKitErrorCodes } from "./errors";

/**
 * Inputs allowing the host system to be derived from current Node values or overrides.
 *
 * @example
 * ```ts
 * import { detectSystem, type DetectSystemInput } from "@loontail/minecraft-kit";
 *
 * // Force the runtime resolver to treat the host as macOS ARM64 regardless of process.platform:
 * const input: DetectSystemInput = { platform: "darwin", arch: "arm64" };
 * const system = detectSystem(input);
 * ```
 */
export type DetectSystemInput = {
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly osVersion?: string;
};

/**
 * Resolve the current host system identifiers.
 *
 * Most callers do not need to invoke this directly: the `MinecraftKit` constructor
 * defaults to `detectSystem()` when no `system` option is supplied, and
 * `kit.targets.system` exposes the cached result. Use this helper when you want to
 * override one of the host values (e.g. force a different `arch` for a cross-platform
 * runtime install) before constructing the kit.
 *
 * @throws {@link MinecraftKitError} with code `RUNTIME_UNSUPPORTED_PLATFORM` when the
 * platform/arch combination is not understood.
 *
 * @example
 * ```ts
 * import { detectSystem } from "@loontail/minecraft-kit";
 *
 * const system = detectSystem();
 * console.log(system.os, system.arch); // → e.g. "windows" "x64"
 * ```
 */
export const detectSystem = (input: DetectSystemInput = {}): RuntimeSystem => {
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const osVersion = input.osVersion ?? os.release();
  const mojangOs = (NODE_PLATFORM_TO_MOJANG_OS as Record<string, OperatingSystem | undefined>)[
    platform
  ];
  const mojangArch = (NODE_ARCH_TO_MOJANG_ARCH as Record<string, Architecture | undefined>)[arch];
  if (mojangOs === undefined || mojangArch === undefined) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.RUNTIME_UNSUPPORTED_PLATFORM,
      `Unsupported platform/arch combination: ${platform}/${arch}`,
      { context: { platform, arch: String(arch) } },
    );
  }
  return { os: mojangOs, arch: mojangArch, osVersion };
};
