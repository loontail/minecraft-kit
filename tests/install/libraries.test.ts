import { describe, expect, it } from "vitest";
import { planLibraryDownloads } from "../../src/install/libraries";
import type { MinecraftLibrary } from "../../src/types/minecraft";
import type { RuntimeSystem } from "../../src/types/system";

const system: RuntimeSystem = { os: "windows", arch: "x64", osVersion: "10.0" };

describe("planLibraryDownloads", () => {
  it("plans artifact download from manifest", () => {
    const libs: MinecraftLibrary[] = [
      {
        name: "x:y:1",
        downloads: {
          artifact: { path: "x/y/1/y-1.jar", sha1: "abc", size: 99, url: "https://x" },
        },
      },
    ];
    const plan = planLibraryDownloads({
      libraries: libs,
      directory: "/r",
      system,
      versionId: "1",
      category: "library",
    });
    expect(plan.downloads.length).toBe(1);
    const first = plan.downloads[0];
    expect(first?.expectedSha1).toBe("abc");
    expect(first?.expectedSize).toBe(99);
  });

  it("skips libraries with disallowing rules", () => {
    const libs: MinecraftLibrary[] = [
      {
        name: "x:y:1",
        rules: [{ action: "allow", os: { name: "linux" } }],
      },
    ];
    const plan = planLibraryDownloads({
      libraries: libs,
      directory: "/r",
      system,
      versionId: "1",
      category: "library",
    });
    expect(plan.downloads).toEqual([]);
  });

  it("plans synthesized downloads from coord+url", () => {
    const libs: MinecraftLibrary[] = [
      { name: "com.example:lib:1.0", url: "https://maven.fabricmc.net/" },
    ];
    const plan = planLibraryDownloads({
      libraries: libs,
      directory: "/r",
      system,
      versionId: "1",
      category: "fabric-library",
    });
    expect(plan.downloads.length).toBe(1);
    expect(plan.downloads[0]?.url).toContain("https://maven.fabricmc.net/");
  });

  it("plans natives via classifiers", () => {
    const libs: MinecraftLibrary[] = [
      {
        name: "org.lwjgl:lwjgl:3",
        natives: { windows: "natives-windows" },
        downloads: {
          classifiers: {
            "natives-windows": {
              path: "org/lwjgl/lwjgl/3/lwjgl-3-natives-windows.jar",
              sha1: "x",
              size: 1,
              url: "https://x",
            },
          },
        },
        extract: { exclude: ["META-INF/"] },
      },
    ];
    const plan = planLibraryDownloads({
      libraries: libs,
      directory: "/r",
      system,
      versionId: "1",
      category: "library",
    });
    expect(plan.downloads.length).toBe(1);
    expect(plan.nativeExtractions.length).toBe(1);
  });

  it("dedupes when same path appears twice", () => {
    const libs: MinecraftLibrary[] = [
      {
        name: "x:y:1",
        downloads: { artifact: { path: "p", sha1: "x", size: 0, url: "u" } },
      },
      {
        name: "x:y:1",
        downloads: { artifact: { path: "p", sha1: "x", size: 0, url: "u" } },
      },
    ];
    const plan = planLibraryDownloads({
      libraries: libs,
      directory: "/r",
      system,
      versionId: "1",
      category: "library",
    });
    expect(plan.downloads.length).toBe(1);
  });

  // `downloads.artifact.path` and the Maven coordinate both come straight from network JSON
  // and are joined onto `libraries/`, so they are the same write-outside-the-root primitive
  // as a zip entry name.
  it("rejects a manifest-supplied artifact path that escapes libraries/", () => {
    const libs: MinecraftLibrary[] = [
      {
        name: "x:y:1",
        downloads: {
          artifact: { path: "../../../evil.bat", sha1: "x", size: 0, url: "https://x" },
        },
      },
    ];
    expect(() =>
      planLibraryDownloads({
        libraries: libs,
        directory: "/r",
        system,
        versionId: "1",
        category: "library",
      }),
    ).toThrowError(/Archive entry rejected/);
  });

  it("rejects a coordinate whose extension escapes libraries/", () => {
    const libs: MinecraftLibrary[] = [{ name: "a:b:c@../../../evil.bat", url: "https://m/" }];
    expect(() =>
      planLibraryDownloads({
        libraries: libs,
        directory: "/r",
        system,
        versionId: "1",
        category: "library",
      }),
    ).toThrowError(/Archive entry rejected/);
  });
});
