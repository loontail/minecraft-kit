import fs from "node:fs/promises";
import path from "node:path";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { ensureDir } from "../core/fs";
import { targetPaths } from "../core/paths";
import type { ResolvedRuntime, RuntimeFilesManifest } from "../types/runtime";

/**
 * Materialize directory placeholders and symlinks declared by a runtime manifest.
 *
 * Plain file entries are handled by the regular downloader; this function fills in the
 * non-file entry types after the downloads have completed.
 *
 * @internal
 */
export const materializeRuntimeExtras = async (input: {
  readonly runtime: ResolvedRuntime;
  readonly directory: string;
  readonly manifest: RuntimeFilesManifest;
}): Promise<void> => {
  const root = targetPaths.runtimeRoot(
    input.directory,
    input.runtime.component,
    input.runtime.installRoot,
  );
  for (const [relativePath, entry] of Object.entries(input.manifest.files)) {
    const fullPath = path.join(root, relativePath);
    if (entry.type === "directory") {
      await ensureDir(fullPath);
    } else if (entry.type === "link") {
      await ensureDir(path.dirname(fullPath));
      await unlinkIfPresent(fullPath);
      await createLinkOrCopy(root, relativePath, entry.target, fullPath);
    } else if (entry.executable && process.platform !== "win32") {
      await tryMakeExecutable(fullPath);
    }
  }
};

/**
 * Best-effort `chmod 0o755` of a runtime binary on POSIX.
 *
 * Failure is intentionally swallowed: the file may simply be on a filesystem that ignores
 * mode bits (FAT, SMB), in which case the launcher will fail later with a clearer error
 * if the binary is truly not executable.
 */
const tryMakeExecutable = async (fullPath: string): Promise<void> => {
  await fs.chmod(fullPath, 0o755).catch(() => {});
};

const unlinkIfPresent = async (target: string): Promise<void> => {
  try {
    await fs.unlink(target);
  } catch (cause) {
    if (isNotFound(cause)) return;
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.FILESYSTEM_WRITE_ERROR,
      `Failed to remove stale runtime entry: ${target}`,
      { cause, context: { filePath: target } },
    );
  }
};

/**
 * Try a symlink first, then fall back to copying the resolved file.
 *
 * Symlink creation is restricted on Windows and some filesystems; the copy fallback keeps
 * the runtime usable in those environments. If the copy itself also fails the runtime is
 * unusable, so the error rethrows with both the symlink and copy failures attached.
 */
const createLinkOrCopy = async (
  root: string,
  relativePath: string,
  linkTarget: string,
  destination: string,
): Promise<void> => {
  try {
    await fs.symlink(linkTarget, destination);
    return;
  } catch (symlinkError) {
    const absoluteSource = path.resolve(path.dirname(path.join(root, relativePath)), linkTarget);
    try {
      await fs.copyFile(absoluteSource, destination);
    } catch (copyError) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.FILESYSTEM_WRITE_ERROR,
        `Failed to materialize runtime entry: ${destination}`,
        {
          cause: copyError,
          context: {
            filePath: destination,
            linkTarget,
            symlinkError: errorMessage(symlinkError),
          },
        },
      );
    }
  }
};

const isNotFound = (error: unknown): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
};

const errorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};
