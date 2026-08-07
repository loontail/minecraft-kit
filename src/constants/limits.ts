/**
 * Per-file size cap during archive extraction (bytes).
 *
 * @internal
 */
export const EXTRACTION_MAX_FILE_SIZE = 256 * 1024 * 1024;

/**
 * Total decompressed-bytes cap per archive.
 *
 * @internal
 */
export const EXTRACTION_MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024;

/**
 * Maximum compression ratio (decompressed / compressed) before treating as a zip bomb.
 *
 * @internal
 */
export const EXTRACTION_MAX_COMPRESSION_RATIO = 200;

/**
 * Maximum entry count per archive.
 *
 * @internal
 */
export const EXTRACTION_MAX_ENTRY_COUNT = 100_000;
