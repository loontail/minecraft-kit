import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractAllToDir, readEntryBuffer, readJarMainClass } from "../../src/core/archive";
import { writeFixtureZip } from "../helpers/zip";

// Regression coverage for stored (uncompressed) archive members. yauzl hands those back as
// fd-slicer's own Readable rather than a zlib PassThrough chain, and reading one through
// async iteration never settles — so every one of these assertions used to hang forever
// rather than fail.
describe("stored archive entries", () => {
  let tmpDir: string;
  let zipPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-stored-"));
    zipPath = path.join(tmpDir, "archive.jar");
    await writeFixtureZip(zipPath, [
      {
        name: "META-INF/MANIFEST.MF",
        content: "Manifest-Version: 1.0\r\nMain-Class: com.e.Main\r\n",
      },
      { name: "install_profile.json", content: '{"spec":1}' },
      { name: "natives/lib.so", content: "native-bytes" },
      { name: "empty.txt" },
    ]);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads a stored entry into a buffer", async () => {
    const buffer = await readEntryBuffer(zipPath, "install_profile.json");
    expect(buffer?.toString("utf8")).toBe('{"spec":1}');
  });

  it("reads a zero-length stored entry", async () => {
    const buffer = await readEntryBuffer(zipPath, "empty.txt");
    expect(buffer?.length).toBe(0);
  });

  it("reads Main-Class from a stored manifest", async () => {
    expect(await readJarMainClass(zipPath)).toBe("com.e.Main");
  });

  it("extracts stored entries to disk", async () => {
    const outDir = path.join(tmpDir, "out");
    const { fileCount } = await extractAllToDir(zipPath, outDir);

    expect(fileCount).toBe(3);
    expect(await fs.readFile(path.join(outDir, "natives", "lib.so"), "utf8")).toBe("native-bytes");
  });
});
