import { describe, expect, it } from "vitest";
import { mergeManifest } from "../../src/core/manifest-merge";
import { asMinecraftVersionId } from "../../src/core/version-id";
import type { MinecraftVersionManifest } from "../../src/types/minecraft";

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
});
