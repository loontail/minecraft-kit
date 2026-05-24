import { describe, expect, it } from "vitest";
import { mergeManifest } from "../../src/core/manifest-merge";
import { asMinecraftVersionId } from "../../src/core/version-id";
import type { MinecraftLibrary, MinecraftVersionManifest } from "../../src/types/minecraft";
import type { RuntimeSystem } from "../../src/types/system";

const baseDownload = { sha1: "x", size: 1, url: "https://x" };
const MC_PARENT = asMinecraftVersionId("1.20.1");
const MC_CHILD = asMinecraftVersionId("fabric-1.20.1");

const parent: MinecraftVersionManifest = {
  id: MC_PARENT,
  type: "release",
  mainClass: "net.minecraft.client.main.Main",
  assetIndex: { id: "5", sha1: "x", size: 1, totalSize: 1, url: "https://x" },
  assets: "5",
  downloads: { client: baseDownload },
  libraries: [{ name: "a:b:1" }],
  arguments: { game: ["--parent"], jvm: [] },
};

const child: MinecraftVersionManifest = {
  id: MC_CHILD,
  type: "release",
  mainClass: "fabric.Main",
  assetIndex: parent.assetIndex,
  assets: "5",
  downloads: { client: baseDownload },
  libraries: [{ name: "x:y:1" }],
  arguments: { game: ["--child"], jvm: [] },
  inheritsFrom: MC_PARENT,
};

describe("mergeManifest", () => {
  it("uses child id and main class", () => {
    const result = mergeManifest(parent, child);
    expect(result.id).toBe("fabric-1.20.1");
    expect(result.mainClass).toBe("fabric.Main");
  });

  it("concatenates libraries", () => {
    const result = mergeManifest(parent, child);
    expect(result.libraries.map((l) => l.name)).toEqual(["a:b:1", "x:y:1"]);
  });

  it("concatenates arguments", () => {
    const result = mergeManifest(parent, child);
    expect(result.arguments?.game).toEqual(["--parent", "--child"]);
  });

  it("falls back to parent when child fields missing", () => {
    const childMinimal = { ...child, mainClass: undefined } as unknown as MinecraftVersionManifest;
    const result = mergeManifest(parent, childMinimal);
    expect(result.mainClass).toBe(parent.mainClass);
  });

  it("returns undefined arguments when neither side has them", () => {
    const { arguments: _parentArgs, ...parentRest } = parent;
    const { arguments: _childArgs, ...childRest } = child;
    const result = mergeManifest(parentRest, childRest);
    expect(result.arguments).toBeUndefined();
  });

  it("omits optional fields when neither side carries them", () => {
    const minimalParent: MinecraftVersionManifest = {
      id: asMinecraftVersionId("1.0"),
      type: "release",
      mainClass: "M",
      assetIndex: parent.assetIndex,
      assets: "5",
      downloads: { client: baseDownload },
      libraries: [],
    };
    const minimalChild: MinecraftVersionManifest = {
      ...minimalParent,
      id: asMinecraftVersionId("1.0-child"),
    };
    const result = mergeManifest(minimalParent, minimalChild);
    expect(result.arguments).toBeUndefined();
    expect(result.javaVersion).toBeUndefined();
    expect(result.logging).toBeUndefined();
    expect(result.inheritsFrom).toBeUndefined();
    expect(result.minecraftArguments).toBeUndefined();
    expect(result.releaseTime).toBeUndefined();
    expect(result.time).toBeUndefined();
    expect(result.minimumLauncherVersion).toBeUndefined();
    expect(result.complianceLevel).toBeUndefined();
  });

  it("forwards all optional fields when only parent carries them", () => {
    const richParent: MinecraftVersionManifest = {
      ...parent,
      javaVersion: { component: "java-runtime-gamma", majorVersion: 17 },
      logging: {
        client: {
          argument: "x",
          file: { id: "f", sha1: "x", size: 1, url: "u" },
          type: "log4j2-xml",
        },
      },
      releaseTime: "2024-01-01T00:00:00+00:00",
      time: "2024-01-01T00:00:00+00:00",
      minimumLauncherVersion: 21,
      complianceLevel: 1,
      minecraftArguments: "--legacy",
    };
    const { arguments: _childArgs, ...childRest } = child;
    const result = mergeManifest(richParent, childRest);
    expect(result.javaVersion).toEqual({ component: "java-runtime-gamma", majorVersion: 17 });
    expect(result.releaseTime).toBe("2024-01-01T00:00:00+00:00");
    expect(result.minimumLauncherVersion).toBe(21);
    expect(result.complianceLevel).toBe(1);
    expect(result.minecraftArguments).toBe("--legacy");
  });

  it("dedupes library entries by group:artifact with child winning", () => {
    const parentWithAsm: MinecraftVersionManifest = {
      ...parent,
      libraries: [{ name: "org.ow2.asm:asm:9.7" }, { name: "io.netty:netty:4.1" }],
    };
    const childWithAsm: MinecraftVersionManifest = {
      ...child,
      libraries: [{ name: "org.ow2.asm:asm:9.8" }, { name: "x:y:1" }],
    };
    const result = mergeManifest(parentWithAsm, childWithAsm);
    expect(result.libraries.map((l) => l.name)).toEqual([
      "org.ow2.asm:asm:9.8",
      "io.netty:netty:4.1",
      "x:y:1",
    ]);
  });

  it("treats different classifiers as distinct libraries", () => {
    const parentWithClassifier: MinecraftVersionManifest = {
      ...parent,
      libraries: [{ name: "org.lwjgl:lwjgl:3.3:natives-windows" }],
    };
    const childWithClassifier: MinecraftVersionManifest = {
      ...child,
      libraries: [{ name: "org.lwjgl:lwjgl:3.3" }],
    };
    const result = mergeManifest(parentWithClassifier, childWithClassifier);
    expect(result.libraries.map((l) => l.name)).toEqual([
      "org.lwjgl:lwjgl:3.3:natives-windows",
      "org.lwjgl:lwjgl:3.3",
    ]);
  });

  it("keeps libraries with unparseable names without dropping them", () => {
    const parentWithBogus: MinecraftVersionManifest = {
      ...parent,
      libraries: [{ name: "not-a-coord" }, { name: "a:b:1" }],
    };
    const childMinimal: MinecraftVersionManifest = { ...child, libraries: [] };
    const result = mergeManifest(parentWithBogus, childMinimal);
    expect(result.libraries.map((l) => l.name)).toEqual(["a:b:1", "not-a-coord"]);
  });

  // ---------------------------------------------------------------------------
  // Vanilla 1.16-1.18 LWJGL shape: two entries per LWJGL module share `name`
  // — one is the primary jar (no `natives` field), one is the natives carrier
  // (`natives: {windows: "natives-windows", …}`). Both must survive the merge,
  // or the primary jar gets clobbered, `buildClasspath` skips the natives
  // entry, and Forge launch crashes with
  // `ClassNotFoundException: org.lwjgl.system.MemoryUtil` during Mixin transform.
  // ---------------------------------------------------------------------------
  const lwjglPrimary: MinecraftLibrary = {
    name: "org.lwjgl:lwjgl:3.2.2",
    downloads: {
      artifact: {
        path: "org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2.jar",
        sha1: "p",
        size: 1,
        url: "https://x",
      },
    },
    rules: [{ action: "allow" }, { action: "disallow", os: { name: "osx" } }],
  };
  const lwjglNatives: MinecraftLibrary = {
    name: "org.lwjgl:lwjgl:3.2.2",
    downloads: {
      artifact: {
        path: "org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2.jar",
        sha1: "p",
        size: 1,
        url: "https://x",
      },
      classifiers: {
        "natives-windows": {
          path: "org/lwjgl/lwjgl/3.2.2/lwjgl-3.2.2-natives-windows.jar",
          sha1: "n",
          size: 1,
          url: "https://x",
        },
      },
    },
    natives: { windows: "natives-windows" },
    rules: [{ action: "allow" }, { action: "disallow", os: { name: "osx" } }],
  };

  it("preserves both primary AND natives entries when vanilla ships dual entries (LWJGL pattern)", () => {
    // Regression: previously the dedupe key was `group:artifact[:classifier]`,
    // so both entries collapsed into one slot and the natives one won by
    // arriving last. buildClasspath would then drop LWJGL off the classpath
    // entirely. The new key splits primary vs natives so both survive.
    const parentWithLwjgl: MinecraftVersionManifest = {
      ...parent,
      libraries: [lwjglPrimary, lwjglNatives],
    };
    const childMinimal: MinecraftVersionManifest = { ...child, libraries: [] };
    const result = mergeManifest(parentWithLwjgl, childMinimal);
    const lwjgl = result.libraries.filter((l) => l.name === "org.lwjgl:lwjgl:3.2.2");
    expect(lwjgl).toHaveLength(2);
    expect(lwjgl.some((l) => !l.natives)).toBe(true);
    expect(lwjgl.some((l) => l.natives !== undefined)).toBe(true);
  });

  it("filters OS-conditional duplicates by rules when `system` is provided", () => {
    // Vanilla 1.18.2 ships `org.lwjgl:lwjgl:3.2.1` for osx AND `:3.2.2` for
    // non-osx as separate entries — same `group:artifact`, different version,
    // different rules. Without rule pre-filtering they share a dedupe slot
    // and the second clobbers the first; on macOS we'd then keep the non-osx
    // entry whose rules filter out at classpath time → no LWJGL.
    const lwjgl321Osx: MinecraftLibrary = {
      name: "org.lwjgl:lwjgl:3.2.1",
      downloads: {
        artifact: {
          path: "org/lwjgl/lwjgl/3.2.1/lwjgl-3.2.1.jar",
          sha1: "p1",
          size: 1,
          url: "https://x",
        },
      },
      rules: [{ action: "allow", os: { name: "osx" } }],
    };
    const macOs: RuntimeSystem = { os: "osx", arch: "x64", osVersion: "12" };
    const parentWithOsDupes: MinecraftVersionManifest = {
      ...parent,
      libraries: [lwjgl321Osx, lwjglPrimary],
    };
    const childMinimal: MinecraftVersionManifest = { ...child, libraries: [] };

    const result = mergeManifest(parentWithOsDupes, childMinimal, macOs);
    const lwjgl = result.libraries.filter((l) => l.name.startsWith("org.lwjgl:lwjgl"));
    expect(lwjgl).toHaveLength(1);
    expect(lwjgl[0]?.name).toBe("org.lwjgl:lwjgl:3.2.1");
  });

  it("still allows Forge to override a vanilla primary entry on the same coordinate", () => {
    // The primary-vs-natives split must NOT regress the override case: Forge
    // shipping `org.ow2.asm:asm:9.3` must still replace vanilla's 9.2 on the
    // classpath. Both have no `natives` field → same `@primary` key → child wins.
    const parentWithAsm: MinecraftVersionManifest = {
      ...parent,
      libraries: [{ name: "org.ow2.asm:asm:9.2" }, { name: "io.netty:netty:4.1" }],
    };
    const childWithAsm: MinecraftVersionManifest = {
      ...child,
      libraries: [{ name: "org.ow2.asm:asm:9.3" }],
    };
    const result = mergeManifest(parentWithAsm, childWithAsm);
    expect(result.libraries.map((l) => l.name)).toEqual([
      "org.ow2.asm:asm:9.3",
      "io.netty:netty:4.1",
    ]);
  });
});
