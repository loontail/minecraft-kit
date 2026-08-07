import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MinecraftKitError, MinecraftKitErrorCodes } from "./errors";

/**
 * Ensure a directory exists, creating intermediate directories as needed.
 *
 * @internal
 */
export const ensureDir = async (directory: string): Promise<void> => {
  try {
    await fs.mkdir(directory, { recursive: true });
  } catch (cause) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.FILESYSTEM_WRITE_ERROR,
      `Failed to create directory: ${directory}`,
      { cause, context: { filePath: directory } },
    );
  }
};

/**
 * Returns true if a path exists and is a regular file.
 *
 * @internal
 */
export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
};

/**
 * Returns true if a path exists and is a directory.
 *
 * @internal
 */
export const dirExists = async (filePath: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(filePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Get file size in bytes; returns -1 when the file is absent.
 *
 * @internal
 */
export const fileSize = async (filePath: string): Promise<number> => {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return -1;
  }
};

/**
 * Atomically write `data` to `target`. Writes to a temp sibling and renames.
 *
 * Creates parent directories if missing. Throws {@link MinecraftKitError} with
 * code `FILESYSTEM_WRITE_ERROR` on failure; the `.tmp` sibling is best-effort
 * unlinked on the error path so a partial write does not linger.
 *
 * @internal
 */
export const atomicWrite = async (target: string, data: Uint8Array | string): Promise<void> => {
  await ensureDir(path.dirname(target));
  const tmp = `${target}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    if (typeof data === "string") {
      await fs.writeFile(tmp, data, "utf8");
    } else {
      await fs.writeFile(tmp, data);
    }
    await fs.rename(tmp, target);
  } catch (cause) {
    try {
      await fs.unlink(tmp);
    } catch {
      /* best-effort cleanup; the primary FILESYSTEM_WRITE_ERROR below carries the real cause */
    }
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.FILESYSTEM_WRITE_ERROR,
      `Failed to write file: ${target}`,
      {
        cause,
        context: { filePath: target },
      },
    );
  }
};

/**
 * Read a file as UTF-8 text, mapping fs errors to a domain error.
 *
 * @internal
 */
export const readText = async (filePath: string): Promise<string> => {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (cause) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.FILESYSTEM_READ_ERROR,
      `Failed to read file: ${filePath}`,
      {
        cause,
        context: { filePath },
      },
    );
  }
};

/**
 * Read a file as bytes, mapping fs errors to a domain error.
 *
 * @internal
 */
export const readBytes = async (filePath: string): Promise<Uint8Array> => {
  try {
    const buf = await fs.readFile(filePath);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (cause) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.FILESYSTEM_READ_ERROR,
      `Failed to read file: ${filePath}`,
      {
        cause,
        context: { filePath },
      },
    );
  }
};

/**
 * List immediate child directory names of `directory`. Returns [] when directory is missing.
 *
 * @internal
 */
export const listChildDirectories = async (directory: string): Promise<readonly string[]> => {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
};

/**
 * Set the executable bit on a file. No-op on Windows (where NTFS does not honour
 * POSIX modes); on POSIX the failure of `chmod` is also swallowed because Java's
 * spawn path can still execute the file when the umask already grants execute
 * (and surfacing a chmod error would mask the more interesting downstream spawn
 * failure if one occurs).
 *
 * @internal
 */
export const chmodExecutable = async (filePath: string): Promise<void> => {
  if (process.platform === "win32") {
    return;
  }
  try {
    await fs.chmod(filePath, 0o755);
  } catch {
    /* best-effort; missing chmod doesn't prevent execution when umask already grants it */
  }
};

/**
 * Verify that `child` is contained in `root`. Used to defeat zip-slip and absolute-path
 * traversal during archive extraction, and to contain the destinations named by a remote
 * runtime manifest.
 *
 * The comparison is case-insensitive on win32 because NTFS is: a caller that hands in an
 * absolute child differing from `root` only in case (or through an 8.3 short name, which
 * `resolve` does not expand) means the same directory, and rejecting it fails a legitimate
 * install. Lowercasing cannot admit an escape — a path that leaves `root` differs by more than
 * case. The check stays purely lexical: `realpath` would cost an fs round-trip per archive entry
 * and cannot be applied to a destination that does not exist yet, and nothing in the kit follows
 * a symlink it did not itself create from a hash-verified manifest.
 *
 * @throws `FILESYSTEM_PATH_TRAVERSAL` when `child` escapes `root`.
 * @internal
 */
export const assertWithinRoot = (root: string, child: string): void => {
  const compare = (value: string): string =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const normalizedRoot = compare(path.resolve(root));
  const normalizedChild = compare(path.resolve(root, child));
  const sep = path.sep;
  if (normalizedChild !== normalizedRoot && !normalizedChild.startsWith(normalizedRoot + sep)) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.FILESYSTEM_PATH_TRAVERSAL,
      `Path escapes root: ${child}`,
      {
        context: { filePath: child, rootDirectory: root },
      },
    );
  }
};
