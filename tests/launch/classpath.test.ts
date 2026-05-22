import { describe, expect, it } from "vitest";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { buildClasspath } from "../../src/launch/classpath";
import type { MinecraftVersionManifest } from "../../src/types/minecraft";
import type { RuntimeSystem } from "../../src/types/system";

const system: RuntimeSystem = { os: "windows", arch: "x64", osVersion: "10.0" };
const MC_1_20_1 = asMinecraftVersionId("1.20.1");

const libraryWithDownloadArtifact = {
  name: "com.example:lib:1.0",
  downloads: {
    artifact: { path: "com/example/lib/1.0/lib-1.0.jar", sha1: "", size: 0, url: "" },
  },
};
const duplicateLibraryDroppedByDedupe = { name: "com.example:lib:1.0" };
const libraryWithNativesSkippedFromClasspath = {
  name: "com.platform:lwjgl:1.0",
  natives: { windows: "natives" },
};
const librarySynthesizedFromCoord = { name: "com.example:nodownloads:2.0" };
const libraryDisallowedByOsRule = {
  name: "com.disallowed:lib:1.0",
  rules: [{ action: "allow", os: { name: "linux" } }],
};

const mergedManifest: MinecraftVersionManifest = {
  id: MC_1_20_1,
  type: "release",
  mainClass: "x",
  assetIndex: { id: "5", sha1: "x", size: 1, totalSize: 1, url: "" },
  assets: "5",
  downloads: { client: { sha1: "", size: 0, url: "" } },
  libraries: [
    libraryWithDownloadArtifact,
    duplicateLibraryDroppedByDedupe,
    libraryWithNativesSkippedFromClasspath,
    librarySynthesizedFromCoord,
    libraryDisallowedByOsRule,
  ],
};

describe("buildClasspath", () => {
  it("includes libraries and version jar", () => {
    const cp = buildClasspath({
      directory: "/r",
      versionId: MC_1_20_1,
      merged: mergedManifest,
      system,
    });
    expect(cp.some((p) => p.includes("lib-1.0.jar"))).toBe(true);
    expect(cp.some((p) => p.includes("nodownloads"))).toBe(true);
    expect(cp.some((p) => p.includes("disallowed"))).toBe(false);
    expect(cp.some((p) => p.includes("1.20.1.jar"))).toBe(true);
  });

  it("dedupes by absolute path", () => {
    const cp = buildClasspath({
      directory: "/r",
      versionId: MC_1_20_1,
      merged: mergedManifest,
      system,
    });
    const libCount = cp.filter((p) => p.includes("lib-1.0.jar")).length;
    expect(libCount).toBe(1);
  });

  it("skips libraries with natives field", () => {
    const cp = buildClasspath({
      directory: "/r",
      versionId: MC_1_20_1,
      merged: mergedManifest,
      system,
    });
    expect(cp.some((p) => p.includes("lwjgl"))).toBe(false);
  });
});
