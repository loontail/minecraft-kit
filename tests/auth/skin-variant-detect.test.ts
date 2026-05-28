import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { detectSkinVariant } from "../../src/auth/skin-variant-detect";
import { isErrorCode } from "../../src/core/errors";

describe("detectSkinVariant", () => {
  it("returns CLASSIC for legacy 64×32 skins", () => {
    const png = encodeRgbaPng(64, 32, () => ({ r: 0, g: 0, b: 0, a: 255 }));
    expect(detectSkinVariant(png)).toBe("CLASSIC");
  });

  it("returns CLASSIC when arm-edge sample pixels are opaque (Steve layout)", () => {
    const png = encodeRgbaPng(64, 64, () => ({ r: 200, g: 100, b: 50, a: 255 }));
    expect(detectSkinVariant(png)).toBe("CLASSIC");
  });

  it("returns SLIM when arm-edge sample pixels are transparent (Alex layout)", () => {
    const png = encodeRgbaPng(64, 64, (x, y) => {
      if (isSlimEmptyPixel(x, y)) return { r: 0, g: 0, b: 0, a: 0 };
      return { r: 200, g: 100, b: 50, a: 255 };
    });
    expect(detectSkinVariant(png)).toBe("SLIM");
  });

  it("falls back to CLASSIC for unusual image dimensions", () => {
    const png = encodeRgbaPng(32, 32, () => ({ r: 0, g: 0, b: 0, a: 255 }));
    expect(detectSkinVariant(png)).toBe("CLASSIC");
  });

  it("treats RGB (no alpha) PNGs as CLASSIC because every pixel is opaque", () => {
    const png = encodeRgbPng(64, 64, () => ({ r: 200, g: 100, b: 50 }));
    expect(detectSkinVariant(png)).toBe("CLASSIC");
  });

  it("throws INVALID_INPUT when the bytes are not a PNG", () => {
    const notPng = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    try {
      detectSkinVariant(notPng);
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "INVALID_INPUT")).toBe(true);
    }
  });
});

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Pixel = { r: number; g: number; b: number; a?: number };

const encodeRgbaPng = (
  width: number,
  height: number,
  paint: (x: number, y: number) => Pixel,
): Uint8Array => encodePng(width, height, paint, 6, 4);

const encodeRgbPng = (
  width: number,
  height: number,
  paint: (x: number, y: number) => Pixel,
): Uint8Array => encodePng(width, height, paint, 2, 3);

const encodePng = (
  width: number,
  height: number,
  paint: (x: number, y: number) => Pixel,
  colorType: number,
  bytesPerPixel: number,
): Uint8Array => {
  const stride = width * bytesPerPixel;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const p = paint(x, y);
      const base = y * (stride + 1) + 1 + x * bytesPerPixel;
      raw[base] = p.r;
      raw[base + 1] = p.g;
      raw[base + 2] = p.b;
      if (bytesPerPixel === 4) raw[base + 3] = p.a ?? 255;
    }
  }
  const compressed = deflateSync(raw);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  // ihdr[10..12] default to 0: compression=deflate, filter=adaptive, interlace=none

  const chunks = [
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const length = data.length;
  const out = new Uint8Array(8 + length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  // CRC is required by the spec but ignored by our decoder, so leave zeros.
  return out;
};

const SLIM_EMPTY_COORDS: ReadonlyArray<readonly [number, number]> = [
  [50, 16],
  [51, 19],
  [54, 20],
  [55, 24],
  [54, 30],
  [55, 31],
  [42, 48],
  [43, 51],
  [46, 52],
  [47, 56],
  [46, 62],
  [47, 63],
];

const isSlimEmptyPixel = (x: number, y: number): boolean =>
  SLIM_EMPTY_COORDS.some(([sx, sy]) => sx === x && sy === y);
