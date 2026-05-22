import path from "node:path";
import { mavenRelativePath, parseMavenCoordinate } from "../core/maven";
import { targetPaths } from "../core/paths";
import { evaluateRules } from "../core/rules";
import type { MinecraftLibrary, MinecraftVersionManifest } from "../types/minecraft";
import type { RuntimeSystem } from "../types/system";

/**
 * Build the classpath entries for a launch.
 *
 * @internal
 */
export const buildClasspath = (input: {
  readonly directory: string;
  readonly versionId: string;
  readonly merged: MinecraftVersionManifest;
  readonly system: RuntimeSystem;
}): readonly string[] => {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const library of input.merged.libraries) {
    if (library.natives) continue;
    if (!evaluateRules(library.rules, { system: input.system })) continue;
    const relative = relativeFor(library);
    if (!relative) continue;
    const absolute = path.join(targetPaths.librariesDir(input.directory), relative);
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    entries.push(absolute);
  }
  const versionJar = targetPaths.versionJar(input.directory, input.versionId);
  if (!seen.has(versionJar)) entries.push(versionJar);
  return entries;
};

const relativeFor = (library: MinecraftLibrary): string | null => {
  if (library.downloads?.artifact?.path) return library.downloads.artifact.path;
  if (library.name) {
    const coord = parseMavenCoordinate(library.name);
    return mavenRelativePath(coord);
  }
  return null;
};
