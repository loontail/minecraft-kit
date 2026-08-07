import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractSingleEntry, resolveContainedDestination } from "../../src/core/archive";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../../src/core/errors";
import { writeFixtureZip } from "../helpers/zip";

const expectCode = async (run: () => Promise<unknown>, code: string): Promise<void> => {
  await expect(run()).rejects.toMatchObject({ code });
};

describe("resolveContainedDestination", () => {
  const root = path.join(path.sep, "root", "libraries");

  it("joins a safe relative path onto the root", () => {
    expect(resolveContainedDestination(root, "a/b/c.jar")).toBe(path.join(root, "a", "b", "c.jar"));
  });

  it("rejects parent traversal", () => {
    expect(() => resolveContainedDestination(root, "../escape.txt")).toThrowError(
      MinecraftKitError,
    );
    try {
      resolveContainedDestination(root, "../escape.txt");
    } catch (error) {
      expect((error as MinecraftKitError).code).toBe(MinecraftKitErrorCodes.ARCHIVE_ENTRY_REJECTED);
    }
  });

  it("rejects absolute paths and reserved Windows device names", () => {
    expect(() => resolveContainedDestination(root, "/etc/passwd")).toThrowError(MinecraftKitError);
    expect(() => resolveContainedDestination(root, "C:/Windows/x.dll")).toThrowError(
      MinecraftKitError,
    );
    expect(() => resolveContainedDestination(root, "a/CON.txt")).toThrowError(MinecraftKitError);
  });

  // `assertSafeEntryName` splits on "/" only, so a backslash-separated escape slips past it;
  // `assertWithinRoot` resolves the path and catches it on win32, where "\" is a separator.
  it.runIf(process.platform === "win32")(
    "rejects a backslash-separated escape that survives the name check",
    () => {
      try {
        resolveContainedDestination(root, "a\\..\\..\\escape.txt");
        expect.unreachable("expected containment rejection");
      } catch (error) {
        expect((error as MinecraftKitError).code).toBe(
          MinecraftKitErrorCodes.FILESYSTEM_PATH_TRAVERSAL,
        );
      }
    },
  );
});

describe("extractSingleEntry", () => {
  let tmpDir: string;
  let zipPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-extract-single-"));
    zipPath = path.join(tmpDir, "archive.zip");
    await writeFixtureZip(zipPath, [{ name: "data/client.lzma", content: "payload" }]);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes the entry under the root", async () => {
    const root = path.join(tmpDir, "out");
    await extractSingleEntry(zipPath, "data/client.lzma", root, "data/client.lzma");
    expect(await fs.readFile(path.join(root, "data", "client.lzma"), "utf8")).toBe("payload");
  });

  it("refuses a destination that escapes the root and writes nothing", async () => {
    const root = path.join(tmpDir, "out");
    await expectCode(
      () => extractSingleEntry(zipPath, "data/client.lzma", root, "../../escape.txt"),
      MinecraftKitErrorCodes.ARCHIVE_ENTRY_REJECTED,
    );
    await expect(fs.access(path.join(tmpDir, "..", "escape.txt"))).rejects.toBeTruthy();
  });

  it("refuses a traversing entry name before touching the archive", async () => {
    await expectCode(
      () => extractSingleEntry(zipPath, "../../etc/passwd", path.join(tmpDir, "out"), "ok.txt"),
      MinecraftKitErrorCodes.ARCHIVE_ENTRY_REJECTED,
    );
  });
});
