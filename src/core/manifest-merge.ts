import type {
  ArgumentEntry,
  MinecraftArguments,
  MinecraftLibrary,
  MinecraftVersionManifest,
} from "../types/minecraft";
import type { RuntimeSystem } from "../types/system";
import { parseMavenCoordinate } from "./maven";
import { evaluateRules } from "./rules";

/**
 * Merge a child Minecraft version manifest with its parent (resolved through `inheritsFrom`).
 *
 * Rules:
 *  - Scalar fields (`mainClass`, `assetIndex`, `assets`, `type`, `minecraftArguments`,
 *    `javaVersion`, `logging`) — child overrides parent when defined, otherwise parent value.
 *  - `libraries` — deduped by `group:artifact[:classifier]` × (primary | natives), with
 *    child winning. When `system` is supplied, entries are rule-filtered first so an
 *    OS-conditional vanilla entry (e.g. 1.18.2 ships `org.lwjgl:lwjgl:3.2.1` for osx
 *    AND `:3.2.2` for non-osx under the same `group:artifact`) doesn't clobber the
 *    applicable one. Fabric Knot and Forge use this dedupe to replace vanilla's
 *    intrinsic libraries (ASM, mixin, intermediary, …) on the classpath.
 *  - `arguments.game` / `arguments.jvm` — additive concat.
 *  - `downloads` — shallow merge; child wins on conflict.
 *
 * @internal
 */
export const mergeManifest = (
  parent: MinecraftVersionManifest,
  child: MinecraftVersionManifest,
  system?: RuntimeSystem,
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
    libraries: mergeLibraries(parent.libraries, child.libraries, system),
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
    // Distinguish "primary jar" vs "natives jar" entries. The Mojang version manifest
    // for 1.16.5/1.17.1/1.18.2 ships two libraries with the SAME `name` per LWJGL
    // module — one with `downloads.artifact` only (the regular jar on classpath) and
    // one carrying `natives: {windows: "natives-windows", …}` plus `downloads.classifiers`
    // (the natives jar to extract). Without this discriminator both entries collapse to
    // one slot, the natives one wins by virtue of arriving last, and `buildClasspath`
    // then skips it via `if (library.natives) continue` — leaving the LWJGL primary off
    // the classpath entirely. Forge launch on 1.16-1.18 then crashes with
    // `ClassNotFoundException: org.lwjgl.system.MemoryUtil` during Mixin transformation.
    const kind = library.natives ? "@natives" : "@primary";
    return `${coord.group}:${coord.artifact}${classifier}${kind}`;
  } catch {
    return null;
  }
};

/**
 * Merge parent + child library lists with child-wins dedup on the Maven
 * coordinate (`group:artifact[:classifier]`) × kind (primary vs natives).
 *
 * Fabric Knot's classpath verifier rejects two copies of intrinsic libraries
 * (ASM, mixin, intermediary, …) and crashes the game, so loader profiles pin
 * versions known to be compatible with themselves and the child entry must
 * win.
 *
 * When `system` is supplied, entries are pre-filtered by their OS rules. This
 * matters because vanilla 1.16.5/1.17.1/1.18.2 ship two versions of each LWJGL
 * module — one rule-gated to osx (e.g. lwjgl 3.2.1) and one to non-osx (3.2.2)
 * — under the same `group:artifact`. Without pre-filtering, the second pair
 * would clobber the first in the dedupe map and the OS-applicable version
 * would be lost. Skipping the system parameter preserves the legacy concat-
 * with-coordinate-dedupe shape for tests that don't care about rules.
 *
 * Libraries without a parseable Maven coordinate fall through to a separate
 * bucket so their ordering relative to one another is preserved.
 *
 * @internal
 */
const mergeLibraries = (
  parent: readonly MinecraftLibrary[],
  child: readonly MinecraftLibrary[],
  system: RuntimeSystem | undefined,
): readonly MinecraftLibrary[] => {
  const applies = system
    ? (lib: MinecraftLibrary): boolean => evaluateRules(lib.rules, { system })
    : (): boolean => true;
  const childWinsByCoordinate = new Map<string, MinecraftLibrary>();
  const withoutParseableCoordinate: MinecraftLibrary[] = [];
  for (const lib of [...parent, ...child]) {
    if (!applies(lib)) continue;
    const key = libraryDedupeKey(lib);
    if (key === null) {
      withoutParseableCoordinate.push(lib);
      continue;
    }
    childWinsByCoordinate.set(key, lib);
  }
  return [...childWinsByCoordinate.values(), ...withoutParseableCoordinate];
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
