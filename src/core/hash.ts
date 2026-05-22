import crypto from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * Compute the SHA-1 of a file on disk. Streams to keep memory usage flat.
 *
 * @internal
 */
export const sha1OfFile = async (filePath: string): Promise<string> => {
  const hash = crypto.createHash("sha1");
  const stream = createReadStream(filePath);
  try {
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
  } finally {
    if (!stream.destroyed) stream.destroy();
  }
  return hash.digest("hex");
};
