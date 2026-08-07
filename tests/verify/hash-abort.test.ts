import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinecraftKitErrorCodes } from "../../src/core/errors";
import { sha1OfFile } from "../../src/core/hash";
import { VerifyFileCategories } from "../../src/types/verify";
import { verifyHashedFiles } from "../../src/verify/helpers";

const { hashProbe } = vi.hoisted(() => ({
  hashProbe: { signals: [] as (AbortSignal | undefined)[] },
}));

vi.mock("../../src/core/hash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/hash")>();
  return {
    ...actual,
    sha1OfFile: async (filePath: string, signal?: AbortSignal): Promise<string> => {
      hashProbe.signals.push(signal);
      return await actual.sha1OfFile(filePath, signal);
    },
  };
});

/** Large enough that the read needs hundreds of separate I/O turns to finish. */
const LARGE_FILE_BYTES = 16 * 1024 * 1024;

// Pressing stop during a repair used to wait out the current file, and a patched Forge client JAR
// is 100-400 MB: the signal was only checked between files, never inside one.
describe("sha1OfFile — abort", () => {
  let directory: string;
  let largeFile: string;

  beforeEach(async () => {
    hashProbe.signals = [];
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-hash-abort-"));
    largeFile = path.join(directory, "large.jar");
    await fs.writeFile(largeFile, Buffer.alloc(LARGE_FILE_BYTES, 7));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("stops reading a file that is aborted mid-hash", async () => {
    const controller = new AbortController();
    const hashing = sha1OfFile(largeFile, controller.signal);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(hashing).rejects.toMatchObject({
      code: MinecraftKitErrorCodes.LAUNCH_ABORTED,
    });
  });

  it("hashes the whole file when the signal never aborts", async () => {
    const controller = new AbortController();

    await expect(sha1OfFile(largeFile, controller.signal)).resolves.toMatch(/^[0-9a-f]{40}$/);
  });

  it("threads the verification signal into every file hash", async () => {
    const controller = new AbortController();

    await verifyHashedFiles(
      () => {},
      [
        {
          path: largeFile,
          expectedSha1: "0".repeat(40),
          category: VerifyFileCategories.LIBRARY,
        },
      ],
      controller.signal,
    );

    expect(hashProbe.signals).toEqual([controller.signal]);
  });
});
