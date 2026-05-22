import type {
  ArgumentEntry,
  MinecraftArguments,
  MinecraftLibrary,
  MinecraftVersionManifest,
} from "../types/minecraft";
import { parseMavenCoordinate } from "./maven";

/**
 * Merge a child Minecraft version manifest with its parent (resolved through `inheritsFrom`).
 *
 * Rules:
 *  - Scalar fields (`mainClass`, `assetIndex`, `assets`, `type`, `minecraftArguments`,
 *    `javaVersion`, `logging`) — child overrides parent when defined, otherwise parent value.
 *  - `libraries` — deduped by `group:artifact[:classifier]` with child winning. Fabric's
 *    Knot loader and modern Forge ship version-pinned copies of intrinsic libraries
 *    (ASM, mixin, intermediary, …) that must replace vanilla's copies on the classpath.
 *  - `arguments.game` / `arguments.jvm` — additive concat.
 *  - `downloads` — shallow merge; child wins on conflict.
 *
 * @internal
 */
export const mergeManifest = (
  parent: MinecraftVersionManifest,
  child: MinecraftVersionManifest,
): MinecraftVersionManifest => {
  const args = mergeArguments(parent.arguments, child.arguments);
  const minecraftArguments = child.minecraftArguments ?? parent.minecraftArguments;
  const javaVersion = child.javaVersion ?? parent.javaVersion;
  const logging = child.logging ?? parent.logging;
  const inheritsFrom = child.inheritsFrom ?? parent.inheritsFrom;
  const releaseTime = child.releaseTime ?? parent.releaseTime;
  const time = child.time ?? parent.time;
  const minimumLauncherVersion = child.minimumLauncherVersion ?? parent.minimumLauncherVersion;
  const complianceLevel = child.complianceLevel ?? parent.complianceLevel;
  return {
    id: child.id || parent.id,
    type: child.type ?? parent.type,
    mainClass: child.mainClass ?? parent.mainClass,
    assetIndex: child.assetIndex ?? parent.assetIndex,
    assets: child.assets ?? parent.assets,
    downloads: { ...parent.downloads, ...child.downloads },
    libraries: mergeLibraries(parent.libraries, child.libraries),
    ...(args !== undefined ? { arguments: args } : {}),
    ...(minecraftArguments !== undefined ? { minecraftArguments } : {}),
    ...(javaVersion !== undefined ? { javaVersion } : {}),
    ...(logging !== undefined ? { logging } : {}),
    ...(inheritsFrom !== undefined ? { inheritsFrom } : {}),
    ...(releaseTime !== undefined ? { releaseTime } : {}),
    ...(time !== undefined ? { time } : {}),
    ...(minimumLauncherVersion !== undefined ? { minimumLauncherVersion } : {}),
    ...(complianceLevel !== undefined ? { complianceLevel } : {}),
  };
};

const libraryDedupeKey = (library: MinecraftLibrary): string | null => {
  if (!library.name) return null;
  try {
    const coord = parseMavenCoordinate(library.name);
    const classifier = coord.classifier ? `:${coord.classifier}` : "";
    return `${coord.group}:${coord.artifact}${classifier}`;
  } catch {
    return null;
  }
};

const mergeLibraries = (
  parent: readonly MinecraftLibrary[],
  child: readonly MinecraftLibrary[],
): readonly MinecraftLibrary[] => {
  // Fabric Knot's classpath verifier rejects two copies of intrinsic libraries
  // (ASM, mixin, intermediary, …). Dedupe by `group:artifact[:classifier]` with
  // child winning — loader profiles pin versions compatible with themselves.
  // Libraries without a parseable Maven coordinate fall through to a separate
  // bucket so their ordering relative to others is preserved.
  const byKey = new Map<string, MinecraftLibrary>();
  const unkeyed: MinecraftLibrary[] = [];
  for (const lib of [...parent, ...child]) {
    const key = libraryDedupeKey(lib);
    if (key === null) {
      unkeyed.push(lib);
      continue;
    }
    byKey.set(key, lib);
  }
  return [...byKey.values(), ...unkeyed];
};

const mergeArguments = (
  parent: MinecraftArguments | undefined,
  child: MinecraftArguments | undefined,
): MinecraftArguments | undefined => {
  if (!parent && !child) return undefined;
  const parentGame: readonly ArgumentEntry[] = parent?.game ?? [];
  const parentJvm: readonly ArgumentEntry[] = parent?.jvm ?? [];
  const childGame: readonly ArgumentEntry[] = child?.game ?? [];
  const childJvm: readonly ArgumentEntry[] = child?.jvm ?? [];
  return {
    game: [...parentGame, ...childGame],
    jvm: [...parentJvm, ...childJvm],
  };
};
