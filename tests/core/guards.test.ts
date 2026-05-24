import { describe, expect, it } from "vitest";
import {
  isArrayOf,
  isArtifactDownload,
  isMinecraftVersionManifestShape,
  isNonEmptyString,
  isNonNegativeInteger,
  isPlainObject,
  isSha1Hex,
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
