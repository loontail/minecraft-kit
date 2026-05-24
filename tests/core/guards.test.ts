import { describe, expect, it } from "vitest";
import {
  isArrayOf,
  isArtifactDownload,
  isAssetIndexShape,
  isFabricProfileShape,
  isJavaRuntimeManifestShape,
  isMinecraftVersionManifestShape,
  isMojangJavaRuntimesShape,
  isNonEmptyString,
  isNonNegativeInteger,
  isPlainObject,
  isSha1Hex,
  isVersionManifestRootShape,
} from "../../src/core/guards";

describe("isPlainObject", () => {
  it("rejects null, arrays, and primitives", () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject("x")).toBe(false);
  });
  it("accepts plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });
});

describe("isNonEmptyString", () => {
  it("rejects empty string and non-strings", () => {
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(0)).toBe(false);
  });
  it("accepts any non-empty string", () => {
    expect(isNonEmptyString("a")).toBe(true);
  });
});

describe("isNonNegativeInteger", () => {
  it("rejects negative, NaN, fractional, and non-numbers", () => {
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(Number.NaN)).toBe(false);
    expect(isNonNegativeInteger(1.5)).toBe(false);
    expect(isNonNegativeInteger("1")).toBe(false);
  });
  it("accepts 0 and positive integers", () => {
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isNonNegativeInteger(42)).toBe(true);
  });
});

describe("isArrayOf", () => {
  it("rejects non-arrays", () => {
    expect(isArrayOf({}, isNonEmptyString)).toBe(false);
  });
  it("returns true when every item passes the guard", () => {
    expect(isArrayOf(["a", "b"], isNonEmptyString)).toBe(true);
  });
  it("returns false when any item fails", () => {
    expect(isArrayOf(["a", "", "c"], isNonEmptyString)).toBe(false);
  });
});

describe("isSha1Hex", () => {
  it("accepts 40-char lower-case hex strings", () => {
    expect(isSha1Hex("0123456789abcdef0123456789abcdef01234567")).toBe(true);
  });
  it("rejects wrong length and upper-case", () => {
    expect(isSha1Hex("abc")).toBe(false);
    expect(isSha1Hex("0123456789ABCDEF0123456789ABCDEF01234567")).toBe(false);
  });
});

describe("isArtifactDownload", () => {
  it("requires sha1 (string), size (number), url (non-empty)", () => {
    expect(
      isArtifactDownload({
        sha1: "0123456789abcdef0123456789abcdef01234567",
        size: 100,
        url: "https://x/",
      }),
    ).toBe(true);
    expect(isArtifactDownload({ sha1: 1, size: 100, url: "https://x/" })).toBe(false);
    expect(isArtifactDownload({ sha1: "x", size: "100", url: "https://x/" })).toBe(false);
    expect(isArtifactDownload({ sha1: "x", size: 100, url: "" })).toBe(false);
    expect(isArtifactDownload(null)).toBe(false);
  });
});

describe("isMinecraftVersionManifestShape", () => {
  const validShape = {
    id: "1.20.1",
    mainClass: "net.minecraft.client.main.Main",
    assetIndex: { id: "5", sha1: "x", size: 1, url: "https://a/" },
    downloads: { client: { sha1: "x", size: 1, url: "https://c/" } },
  };

  it("accepts a well-shaped manifest", () => {
    expect(isMinecraftVersionManifestShape(validShape)).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(isMinecraftVersionManifestShape(null)).toBe(false);
    expect(isMinecraftVersionManifestShape([])).toBe(false);
    expect(isMinecraftVersionManifestShape("manifest")).toBe(false);
  });

  it("rejects missing id", () => {
    expect(isMinecraftVersionManifestShape({ ...validShape, id: "" })).toBe(false);
    const { id: _id, ...withoutId } = validShape;
    expect(isMinecraftVersionManifestShape(withoutId)).toBe(false);
  });

  it("rejects missing mainClass", () => {
    expect(isMinecraftVersionManifestShape({ ...validShape, mainClass: "" })).toBe(false);
    const { mainClass: _mc, ...withoutMainClass } = validShape;
    expect(isMinecraftVersionManifestShape(withoutMainClass)).toBe(false);
  });

  it("rejects missing assetIndex entirely", () => {
    const { assetIndex: _ai, ...withoutAssetIndex } = validShape;
    expect(isMinecraftVersionManifestShape(withoutAssetIndex)).toBe(false);
    expect(isMinecraftVersionManifestShape({ ...validShape, assetIndex: null })).toBe(false);
  });

  it("rejects missing assetIndex.url", () => {
    expect(
      isMinecraftVersionManifestShape({
        ...validShape,
        assetIndex: { ...validShape.assetIndex, url: "" },
      }),
    ).toBe(false);
  });

  it("rejects missing downloads.client", () => {
    expect(isMinecraftVersionManifestShape({ ...validShape, downloads: {} })).toBe(false);
    const { downloads: _dl, ...withoutDownloads } = validShape;
    expect(isMinecraftVersionManifestShape(withoutDownloads)).toBe(false);
  });
});

describe("isVersionManifestRootShape", () => {
  const valid = {
    latest: { release: "1.20.1", snapshot: "23w14a" },
    versions: [
      {
        id: "1.20.1",
        type: "release",
        url: "https://m/1.20.1",
        time: "t",
        releaseTime: "r",
        sha1: "x",
        complianceLevel: 1,
      },
    ],
  };

  it("accepts a well-shaped manifest root", () => {
    expect(isVersionManifestRootShape(valid)).toBe(true);
  });

  it("accepts an empty versions array", () => {
    expect(isVersionManifestRootShape({ ...valid, versions: [] })).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(isVersionManifestRootShape(null)).toBe(false);
    expect(isVersionManifestRootShape([])).toBe(false);
    expect(isVersionManifestRootShape("root")).toBe(false);
  });

  it("rejects missing latest.release / latest.snapshot", () => {
    expect(
      isVersionManifestRootShape({ ...valid, latest: { release: "", snapshot: "23w14a" } }),
    ).toBe(false);
    expect(
      isVersionManifestRootShape({ ...valid, latest: { release: "1.20.1", snapshot: "" } }),
    ).toBe(false);
    expect(isVersionManifestRootShape({ ...valid, latest: null })).toBe(false);
  });

  it("rejects non-array versions", () => {
    expect(isVersionManifestRootShape({ ...valid, versions: {} })).toBe(false);
  });

  it("rejects a summary entry missing required fields", () => {
    const broken = { ...valid, versions: [{ id: "1", type: "release", url: "u" }] };
    expect(isVersionManifestRootShape(broken)).toBe(false);
  });

  it("rejects a non-object summary entry", () => {
    expect(isVersionManifestRootShape({ ...valid, versions: [null] })).toBe(false);
  });
});

describe("isAssetIndexShape", () => {
  const valid = {
    objects: {
      "minecraft/sounds/a.ogg": { hash: "abc", size: 100 },
      "minecraft/sounds/b.ogg": { hash: "def", size: 200 },
    },
  };

  it("accepts a well-shaped asset index", () => {
    expect(isAssetIndexShape(valid)).toBe(true);
  });

  it("accepts an empty objects map", () => {
    expect(isAssetIndexShape({ objects: {} })).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(isAssetIndexShape(null)).toBe(false);
    expect(isAssetIndexShape([])).toBe(false);
  });

  it("rejects missing objects field", () => {
    expect(isAssetIndexShape({})).toBe(false);
  });

  it("rejects entries with wrong field types", () => {
    expect(isAssetIndexShape({ objects: { x: { hash: 1, size: 100 } } })).toBe(false);
    expect(isAssetIndexShape({ objects: { x: { hash: "h", size: "100" } } })).toBe(false);
    expect(isAssetIndexShape({ objects: { x: null } })).toBe(false);
  });
});

describe("isMojangJavaRuntimesShape", () => {
  const valid = {
    "windows-x64": {
      "java-runtime-gamma": [
        {
          availability: { group: 1, progress: 100 },
          manifest: { sha1: "x", size: 1, url: "https://m/" },
          version: { name: "17.0.8", released: "2024-01-01" },
        },
      ],
    },
    linux: {},
  };

  it("accepts a well-shaped runtime index", () => {
    expect(isMojangJavaRuntimesShape(valid)).toBe(true);
  });

  it("accepts platforms with empty component maps", () => {
    expect(isMojangJavaRuntimesShape({ linux: {} })).toBe(true);
  });

  it("accepts components with empty entry arrays", () => {
    expect(isMojangJavaRuntimesShape({ "windows-x64": { "java-runtime-alpha": [] } })).toBe(true);
  });

  it("rejects non-object root", () => {
    expect(isMojangJavaRuntimesShape(null)).toBe(false);
    expect(isMojangJavaRuntimesShape([])).toBe(false);
  });

  it("rejects non-array component value", () => {
    expect(isMojangJavaRuntimesShape({ "windows-x64": { "java-runtime-gamma": {} } })).toBe(false);
  });

  it("rejects entry missing manifest.url", () => {
    const broken = {
      "windows-x64": {
        "java-runtime-gamma": [
          {
            availability: { group: 1, progress: 100 },
            manifest: { sha1: "x", size: 1, url: "" },
            version: { name: "17.0.8", released: "2024-01-01" },
          },
        ],
      },
    };
    expect(isMojangJavaRuntimesShape(broken)).toBe(false);
  });

  it("rejects entry missing version.name", () => {
    const broken = {
      "windows-x64": {
        "java-runtime-gamma": [
          {
            availability: { group: 1, progress: 100 },
            manifest: { sha1: "x", size: 1, url: "https://m/" },
            version: { name: "", released: "2024-01-01" },
          },
        ],
      },
    };
    expect(isMojangJavaRuntimesShape(broken)).toBe(false);
  });

  it("rejects entry missing manifest object", () => {
    const broken = {
      "windows-x64": {
        "java-runtime-gamma": [{ version: { name: "17", released: "r" } }],
      },
    };
    expect(isMojangJavaRuntimesShape(broken)).toBe(false);
  });
});

describe("isJavaRuntimeManifestShape", () => {
  const valid = {
    files: {
      "bin/javaw.exe": {
        type: "file",
        executable: true,
        downloads: { raw: { sha1: "x", size: 1, url: "https://r/" } },
      },
      bin: { type: "directory" },
      "bin/link": { type: "link", target: "bin/javaw.exe" },
    },
  };

  it("accepts a well-shaped manifest", () => {
    expect(isJavaRuntimeManifestShape(valid)).toBe(true);
  });

  it("accepts an empty files map", () => {
    expect(isJavaRuntimeManifestShape({ files: {} })).toBe(true);
  });

  it("rejects non-object root", () => {
    expect(isJavaRuntimeManifestShape(null)).toBe(false);
    expect(isJavaRuntimeManifestShape([])).toBe(false);
  });

  it("rejects missing files field", () => {
    expect(isJavaRuntimeManifestShape({})).toBe(false);
  });

  it("rejects an entry without type", () => {
    expect(isJavaRuntimeManifestShape({ files: { x: { executable: true } } })).toBe(false);
  });

  it("rejects a null entry", () => {
    expect(isJavaRuntimeManifestShape({ files: { x: null } })).toBe(false);
  });
});

describe("isFabricProfileShape", () => {
  const valid = {
    id: "fabric-loader-0.14.21-1.20.1",
    inheritsFrom: "1.20.1",
    type: "release",
    mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
    libraries: [{ name: "com.example:lib:1.0", url: "https://maven/" }],
  };

  it("accepts a well-shaped profile", () => {
    expect(isFabricProfileShape(valid)).toBe(true);
  });

  it("accepts an empty libraries array", () => {
    expect(isFabricProfileShape({ ...valid, libraries: [] })).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(isFabricProfileShape(null)).toBe(false);
    expect(isFabricProfileShape([])).toBe(false);
  });

  it("rejects missing id / inheritsFrom / mainClass", () => {
    expect(isFabricProfileShape({ ...valid, id: "" })).toBe(false);
    expect(isFabricProfileShape({ ...valid, inheritsFrom: "" })).toBe(false);
    expect(isFabricProfileShape({ ...valid, mainClass: "" })).toBe(false);
  });

  it("rejects non-array libraries", () => {
    expect(isFabricProfileShape({ ...valid, libraries: {} })).toBe(false);
  });

  it("rejects a library missing name", () => {
    expect(isFabricProfileShape({ ...valid, libraries: [{ url: "https://m/" }] })).toBe(false);
  });

  it("rejects a non-object library entry", () => {
    expect(isFabricProfileShape({ ...valid, libraries: [null] })).toBe(false);
  });
});
