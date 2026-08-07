import { createWriteStream } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import {
  EXTRACTION_MAX_COMPRESSION_RATIO,
  EXTRACTION_MAX_ENTRY_COUNT,
  EXTRACTION_MAX_FILE_SIZE,
  EXTRACTION_MAX_TOTAL_SIZE,
} from "../constants/limits";
import { MinecraftKitError, MinecraftKitErrorCodes } from "./errors";
import { assertWithinRoot, atomicWrite, chmodExecutable, ensureDir } from "./fs";

/**
 * A single zip entry exposed to callers.
 *
 * @internal
 */
export type ZipEntry = {
  readonly name: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly isDirectory: boolean;
  /** Read the entry contents into a Buffer (size limits enforced). */
  readBuffer(): Promise<Buffer>;
  /** Stream the entry contents. */
  openReadStream(): Promise<Readable>;
};

/**
 * Open a zip/jar file for streaming inspection.
 *
 * @internal
 */
export const openZip = (filePath: string): Promise<ZipReader> => {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zipFile) => {
      if (err || !zipFile) {
        reject(
          new MinecraftKitError(
            MinecraftKitErrorCodes.ARCHIVE_INVALID,
            `Failed to open archive: ${filePath}`,
            {
              cause: err,
              context: { filePath },
            },
          ),
        );
        return;
      }
      resolve(new ZipReader(zipFile, filePath));
    });
  });
};

/**
 * Reader for a single zip file.
 *
 * @internal
 */
export class ZipReader {
  constructor(
    private readonly file: yauzl.ZipFile,
    private readonly filePath: string,
  ) {}

  /** Iterate every entry. Caller may break out of the loop early. */
  async *entries(): AsyncGenerator<ZipEntry> {
    const file = this.file;
    let count = 0;
    while (true) {
      const entry = await this.readNext();
      if (entry === null) return;
      count++;
      if (count > EXTRACTION_MAX_ENTRY_COUNT) {
        throw new MinecraftKitError(
          MinecraftKitErrorCodes.ARCHIVE_TOO_LARGE,
          `Archive contains too many entries: ${this.filePath}`,
          { context: { filePath: this.filePath } },
        );
      }
      yield this.toZipEntry(entry, file);
    }
  }

  /** Find a single entry by name. Returns undefined if absent. */
  async findEntry(name: string): Promise<ZipEntry | undefined> {
    for await (const entry of this.entries()) {
      if (entry.name === name) return entry;
    }
    return undefined;
  }

  /** Close the reader. */
  close(): void {
    this.file.close();
  }

  private readNext(): Promise<yauzl.Entry | null> {
    return new Promise((resolve, reject) => {
      const onEntry = (entry: yauzl.Entry): void => {
        cleanup();
        resolve(entry);
      };
      const onEnd = (): void => {
        cleanup();
        resolve(null);
      };
      const onError = (err: unknown): void => {
        cleanup();
        reject(
          new MinecraftKitError(
            MinecraftKitErrorCodes.ARCHIVE_INVALID,
            "Failed to read archive entry",
            {
              cause: err,
              context: { filePath: this.filePath },
            },
          ),
        );
      };
      const cleanup = (): void => {
        this.file.removeListener("entry", onEntry);
        this.file.removeListener("end", onEnd);
        this.file.removeListener("error", onError);
      };
      this.file.once("entry", onEntry);
      this.file.once("end", onEnd);
      this.file.once("error", onError);
      this.file.readEntry();
    });
  }

  private toZipEntry(entry: yauzl.Entry, file: yauzl.ZipFile): ZipEntry {
    const name = entry.fileName;
    const isDirectory = name.endsWith("/");
    return {
      name,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      isDirectory,
      readBuffer: async () => {
        if (entry.uncompressedSize > EXTRACTION_MAX_FILE_SIZE) {
          throw new MinecraftKitError(
            MinecraftKitErrorCodes.ARCHIVE_TOO_LARGE,
            `Archive entry exceeds size cap: ${name}`,
            { context: { filePath: this.filePath, entryName: name, size: entry.uncompressedSize } },
          );
        }
        if (
          entry.compressedSize > 0 &&
          entry.uncompressedSize / entry.compressedSize > EXTRACTION_MAX_COMPRESSION_RATIO
        ) {
          throw new MinecraftKitError(
            MinecraftKitErrorCodes.ARCHIVE_TOO_LARGE,
            `Archive entry exceeds compression-ratio cap: ${name}`,
            { context: { filePath: this.filePath, entryName: name } },
          );
        }
        const stream = await openStream(file, entry, this.filePath);
        return await collectStream(stream, this.filePath, name);
      },
      openReadStream: () => openStream(file, entry, this.filePath),
    };
  }
}

/**
 * Drain a yauzl entry stream into one Buffer using flow-mode events.
 *
 * `for await (const chunk of stream)` cannot be used here: for a *stored* (uncompressed)
 * entry yauzl hands back fd-slicer's own `Readable`, whose `_read` never runs under async
 * iteration, so the promise never settles and the whole install hangs. Deflated entries go
 * through a zlib `PassThrough` chain and hide the problem, which is why it only bites on
 * archives that contain stored members.
 */
const collectStream = (
  stream: Readable,
  archivePath: string,
  entryName: string,
): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.once("end", () => resolve(Buffer.concat(chunks)));
    stream.once("error", (cause: unknown) => {
      reject(
        new MinecraftKitError(
          MinecraftKitErrorCodes.ARCHIVE_INVALID,
          `Failed to read archive entry: ${entryName}`,
          { cause, context: { filePath: archivePath, entryName } },
        ),
      );
    });
  });
};

const openStream = (
  file: yauzl.ZipFile,
  entry: yauzl.Entry,
  archivePath: string,
): Promise<Readable> => {
  return new Promise((resolve, reject) => {
    file.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(
          new MinecraftKitError(
            MinecraftKitErrorCodes.ARCHIVE_INVALID,
            `Failed to open archive entry: ${entry.fileName}`,
            { cause: err, context: { filePath: archivePath, entryName: entry.fileName } },
          ),
        );
        return;
      }
      resolve(stream);
    });
  });
};

/**
 * Inputs to {@link extractEntryToDir}.
 *
 * @internal
 */
export type ExtractOptions = {
  /** Path-prefix exclusion list. Defaults to `["META-INF/"]`. */
  readonly excludePrefixes?: readonly string[];
  /** When false, refuse to overwrite existing files. */
  readonly overwrite?: boolean;
};

/**
 * Extract every file entry from a zip into `targetDir`, applying safety checks.
 *
 * @internal
 */
export const extractAllToDir = async (
  zipPath: string,
  targetDir: string,
  options: ExtractOptions = {},
): Promise<{ readonly fileCount: number }> => {
  const exclude = options.excludePrefixes ?? ["META-INF/"];
  let fileCount = 0;
  let totalSize = 0;
  await ensureDir(targetDir);
  const reader = await openZip(zipPath);
  try {
    for await (const entry of reader.entries()) {
      if (entry.isDirectory) continue;
      if (exclude.some((prefix) => entry.name.startsWith(prefix))) continue;
      const destination = resolveContainedDestination(targetDir, entry.name);
      totalSize += entry.uncompressedSize;
      if (totalSize > EXTRACTION_MAX_TOTAL_SIZE) {
        throw new MinecraftKitError(
          MinecraftKitErrorCodes.ARCHIVE_TOO_LARGE,
          `Archive total size cap exceeded: ${zipPath}`,
          { context: { filePath: zipPath } },
        );
      }
      if (entry.uncompressedSize > EXTRACTION_MAX_FILE_SIZE) {
        throw new MinecraftKitError(
          MinecraftKitErrorCodes.ARCHIVE_TOO_LARGE,
          `Archive entry exceeds size cap: ${entry.name}`,
          { context: { filePath: zipPath, entryName: entry.name } },
        );
      }
      await ensureDir(path.dirname(destination));
      const stream = await entry.openReadStream();
      await pipeline(stream, createWriteStream(destination));
      if (
        entry.name.endsWith(".so") ||
        entry.name.endsWith(".dylib") ||
        entry.name.endsWith(".jnilib")
      ) {
        await chmodExecutable(destination);
      }
      fileCount++;
    }
  } finally {
    reader.close();
  }
  return { fileCount };
};

const RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/**
 * Reject entry names that are dangerous regardless of containment.
 *
 * @internal
 */
export const assertSafeEntryName = (name: string): void => {
  if (!name) {
    throw rejectEntry(name, "empty entry name");
  }
  if (name.includes(String.fromCharCode(0))) {
    throw rejectEntry(name, "null byte");
  }
  if (path.posix.isAbsolute(name) || /^[a-zA-Z]:/.test(name) || name.startsWith("\\")) {
    throw rejectEntry(name, "absolute path");
  }
  const segments = name.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      throw rejectEntry(name, "parent traversal");
    }
    if (RESERVED_NAME.test(segment)) {
      throw rejectEntry(name, "reserved Windows name");
    }
    if (/[\s.]$/.test(segment)) {
      throw rejectEntry(name, "trailing dot or whitespace");
    }
  }
};

const rejectEntry = (name: string, reason: string): MinecraftKitError => {
  return new MinecraftKitError(
    MinecraftKitErrorCodes.ARCHIVE_ENTRY_REJECTED,
    `Archive entry rejected (${reason}): ${name}`,
    { context: { entryName: name, reason } },
  );
};

/**
 * Resolve an archive-controlled relative path into an absolute destination inside `root`.
 *
 * Every write path that derives a filename from archive or archive-metadata content must go
 * through this instead of a bare `path.join`, so zip-slip containment is a property of the
 * primitive rather than something each call site has to remember.
 *
 * @throws `ARCHIVE_ENTRY_REJECTED` when the name is dangerous regardless of containment
 * (absolute, `..` segment, null byte, reserved Windows name, trailing dot/space).
 * @throws `FILESYSTEM_PATH_TRAVERSAL` when the resolved path escapes `root`.
 * @internal
 */
export const resolveContainedDestination = (root: string, relativePath: string): string => {
  assertSafeEntryName(relativePath);
  assertWithinRoot(root, relativePath);
  return path.join(root, relativePath);
};

/**
 * Read a single named entry to a Buffer. Returns undefined if missing.
 *
 * @internal
 */
export const readEntryBuffer = async (
  zipPath: string,
  entryName: string,
): Promise<Buffer | undefined> => {
  const reader = await openZip(zipPath);
  try {
    const entry = await reader.findEntry(entryName);
    if (!entry) return undefined;
    return await entry.readBuffer();
  } finally {
    reader.close();
  }
};

/**
 * Extract a single entry to `<root>/<relativeDestination>`.
 *
 * The destination is expressed as a root plus a relative path rather than a ready-made
 * absolute path so containment can be enforced here — callers routinely derive
 * `relativeDestination` from attacker-influenceable archive metadata.
 *
 * @internal
 */
export const extractSingleEntry = async (
  zipPath: string,
  entryName: string,
  root: string,
  relativeDestination: string,
): Promise<void> => {
  assertSafeEntryName(entryName);
  const destination = resolveContainedDestination(root, relativeDestination);
  const buffer = await readEntryBuffer(zipPath, entryName);
  if (!buffer) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.ARCHIVE_INVALID,
      `Archive entry not found: ${entryName}`,
      {
        context: { filePath: zipPath, entryName },
      },
    );
  }
  await atomicWrite(destination, buffer);
};

/**
 * JAR manifest line-continuation: a line break followed by a single space or tab joins
 * the next line onto the previous one. See JAR specification.
 */
const MANIFEST_LINE_CONTINUATION = /\r?\n[ \t]/g;
const MANIFEST_MAIN_CLASS = /^Main-Class:\s*(.+)$/i;

/**
 * Read the `Main-Class` attribute from a JAR's `META-INF/MANIFEST.MF`.
 *
 * @internal
 */
export const readJarMainClass = async (zipPath: string): Promise<string | undefined> => {
  const buf = await readEntryBuffer(zipPath, "META-INF/MANIFEST.MF");
  if (!buf) return undefined;
  const text = buf.toString("utf8").replaceAll(MANIFEST_LINE_CONTINUATION, "");
  for (const line of text.split(/\r?\n/)) {
    const match = MANIFEST_MAIN_CLASS.exec(line);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
};
