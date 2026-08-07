import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { assertNotAborted } from "./abort";
import { withOptionalSignal } from "./optional";

/**
 * Compute the SHA-1 of a file on disk. Streams to keep memory usage flat.
 *
 * The signal reaches the read stream itself, not just the call boundary: a patched Forge client JAR
 * is 100-400 MB, and checking only before the read meant a cancel during verify or repair waited
 * out the whole file. An aborted read surfaces as `LAUNCH_ABORTED` like every other cancellation.
 *
 * @internal
 */
export const sha1OfFile = async (filePath: string, signal?: AbortSignal): Promise<string> => {
  const hash = crypto.createHash("sha1");
  const stream = createReadStream(filePath, withOptionalSignal(signal));
  try {
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
  } catch (error) {
    assertNotAborted(signal, `Hashing aborted by signal: ${filePath}`);
    throw error;
  } finally {
    if (!stream.destroyed) stream.destroy();
  }
  return hash.digest("hex");
};
