import { inflateSync } from "node:zlib";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import type { SkinVariant } from "../types/auth";

/**
 * Skin-variant input that accepts `"AUTO"` in addition to the regular
 * {@link SkinVariant}. `"AUTO"` triggers per-pixel detection by
 * {@link detectSkinVariant} — useful when the caller does not know
 * whether the user picked a Steve-style or Alex-style PNG.
 *
 * @example
 * ```ts
 * import type { SkinVariantInput } from "@loontail/minecraft-kit";
 *
 * const variant: SkinVariantInput = "AUTO";
 * await kit.auth.profile.uploadSkin({ accessToken, skin, variant });
 * ```
 */
export type SkinVariantInput = SkinVariant | "AUTO";

/**
 * Inspect the raw PNG bytes of a Minecraft skin and decide whether it
 * follows the 4-pixel-wide arm (`"CLASSIC"` / Steve) or 3-pixel-wide arm
 * (`"SLIM"` / Alex) model.
 *
 * The check works by sampling pixels that are guaranteed to be transparent
 * in the SLIM layout but opaque in the CLASSIC layout (the 4th column of
 * each arm face in 64×64 skins). Legacy 64×32 skins always return
 * `"CLASSIC"` because the slim layout does not exist in that format.
 *
 * Throws `MinecraftKitError(INVALID_INPUT)` when the input is not a
 * supported PNG (bit-depth other than 8, interlaced, or a color type other
 * than RGB / RGBA).
 *
 * @example
 * ```ts
 * import { detectSkinVariant } from "@loontail/minecraft-kit";
 * import { readFile } from "node:fs/promises";
 *
 * const png = await readFile("./my-skin.png");
 * const variant = detectSkinVariant(png); // → "CLASSIC" | "SLIM"
 * ```
 */
export const detectSkinVariant = (png: Uint8Array): SkinVariant => {
  const decoded = decodePng(png);
  // 64×32 legacy skins predate Alex and can only render as Steve.
  if (decoded.height === 32) return "CLASSIC";
  // Anything that is not the canonical 64×64 modern layout — fall back to
  // CLASSIC. The caller can always override by passing an explicit variant.
  if (decoded.width !== 64 || decoded.height !== 64) return "CLASSIC";

  let transparent = 0;
  for (const [x, y] of SLIM_EMPTY_SAMPLES) {
    const idx = (y * decoded.width + x) * 4 + 3;
    if (decoded.rgba[idx] === 0) transparent++;
  }
  // Majority vote — a SLIM skin should have every sample fully transparent
  // (alpha == 0). Lazy edits or partial paints can leave a few opaque, so
  // accept a small amount of noise.
  return transparent * 2 >= SLIM_EMPTY_SAMPLES.length ? "SLIM" : "CLASSIC";
};

const PNG_SIGNATURE: ReadonlyArray<number> = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

type DecodedPng = {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA pixels, 4 bytes per pixel. */
  readonly rgba: Uint8Array;
};

/**
 * Coordinates of pixels that are part of an arm face in CLASSIC but fall
 * outside every face in SLIM. A pixel here being transparent is strong
 * evidence the texture was authored for the SLIM model.
 *
 * The samples are split across both arms so the heuristic still works on
 * skins that left one arm's overlay blank.
 */
const SLIM_EMPTY_SAMPLES: ReadonlyArray<readonly [number, number]> = [
  // Right arm — classic bottom face (cols 50, 51) at top corners + middle.
  [50, 16],
  [51, 19],
  // Right arm — classic back face right edge (cols 54, 55) across the arm.
  [54, 20],
  [55, 24],
  [54, 30],
  [55, 31],
  // Left arm — classic bottom face (cols 42, 43) at top corners.
  [42, 48],
  [43, 51],
  // Left arm — classic back face right edge (cols 46, 47) across the arm.
  [46, 52],
  [47, 56],
  [46, 62],
  [47, 63],
];

const decodePng = (bytes: Uint8Array): DecodedPng => {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.INVALID_INPUT,
        "Skin variant detection: input is not a PNG file (missing PNG signature).",
      );
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idatChunks: Uint8Array[] = [];

  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type =
      String.fromCharCode(bytes[offset + 4] ?? 0) +
      String.fromCharCode(bytes[offset + 5] ?? 0) +
      String.fromCharCode(bytes[offset + 6] ?? 0) +
      String.fromCharCode(bytes[offset + 7] ?? 0);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === "IHDR") {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8] ?? 0;
      colorType = bytes[dataStart + 9] ?? -1;
      interlace = bytes[dataStart + 12] ?? 0;
    } else if (type === "IDAT") {
      idatChunks.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4; // 4 trailing CRC bytes.
  }

  if (bitDepth !== 8) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `Skin variant detection: unsupported PNG bit depth ${bitDepth}; only 8-bit is supported.`,
    );
  }
  if (interlace !== 0) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      "Skin variant detection: interlaced PNGs are not supported.",
    );
  }
  if (colorType !== 2 && colorType !== 6) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `Skin variant detection: unsupported PNG color type ${colorType}; expected RGB (2) or RGBA (6).`,
    );
  }

  const totalCompressed = idatChunks.reduce((sum, c) => sum + c.length, 0);
  const compressed = new Uint8Array(totalCompressed);
  {
    let pos = 0;
    for (const c of idatChunks) {
      compressed.set(c, pos);
      pos += c.length;
    }
  }
  const inflated = new Uint8Array(inflateSync(compressed));

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const rgba = new Uint8Array(width * height * 4);
  let previousRow = new Uint8Array(stride);
  const currentRow = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filterType = inflated[rowStart] ?? 0;
    for (let x = 0; x < stride; x++) {
      const raw = inflated[rowStart + 1 + x] ?? 0;
      const left = x >= bytesPerPixel ? (currentRow[x - bytesPerPixel] ?? 0) : 0;
      const up = previousRow[x] ?? 0;
      const upLeft = x >= bytesPerPixel ? (previousRow[x - bytesPerPixel] ?? 0) : 0;
      currentRow[x] = unfilterByte(filterType, raw, left, up, upLeft);
    }
    for (let x = 0; x < width; x++) {
      const off = (y * width + x) * 4;
      rgba[off] = currentRow[x * bytesPerPixel] ?? 0;
      rgba[off + 1] = currentRow[x * bytesPerPixel + 1] ?? 0;
      rgba[off + 2] = currentRow[x * bytesPerPixel + 2] ?? 0;
      rgba[off + 3] = colorType === 6 ? (currentRow[x * bytesPerPixel + 3] ?? 0) : 255;
    }
    previousRow = new Uint8Array(currentRow);
  }

  return { width, height, rgba };
};

const unfilterByte = (
  filterType: number,
  raw: number,
  left: number,
  up: number,
  upLeft: number,
): number => {
  switch (filterType) {
    case 0:
      return raw & 0xff;
    case 1:
      return (raw + left) & 0xff;
    case 2:
      return (raw + up) & 0xff;
    case 3:
      return (raw + ((left + up) >> 1)) & 0xff;
    case 4:
      return (raw + paeth(left, up, upLeft)) & 0xff;
    default:
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.INVALID_INPUT,
        `Skin variant detection: unknown PNG scanline filter ${filterType}.`,
      );
  }
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};
