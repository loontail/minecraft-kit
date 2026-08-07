import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinecraftKitErrorCodes } from "../../src/core/errors";
import { materializeRuntimeExtras } from "../../src/install/runtime-extras";
import type { ResolvedRuntime, RuntimeFilesManifest } from "../../src/types/runtime";

const runtime: ResolvedRuntime = {
  component: "java-runtime-gamma",
  platformKey: "linux",
  versionName: "17",
  system: { os: "linux", arch: "x64", osVersion: "6.1" },
  manifestUrl: "https://m/",
  manifestSha1: "x",
};

describe("materializeRuntimeExtras — links and modes", () => {
  let directory: string;
  let runtimeRoot: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-runtime-links-"));
    runtimeRoot = path.join(directory, "runtime", runtime.component);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  const materialize = (manifest: unknown) =>
    materializeRuntimeExtras({
      runtime,
      directory,
      manifest: manifest as RuntimeFilesManifest,
    });

  const seedFile = async (relative: string, body = "payload"): Promise<string> => {
    const full = path.join(runtimeRoot, relative);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
    return full;
  };

  it("creates the parent directory of a link before linking", async () => {
    await seedFile("lib/libjvm.so");

    await materialize({
      files: { "lib/server/libjvm.so": { type: "link", target: "../libjvm.so" } },
    });

    const linkPath = path.join(runtimeRoot, "lib", "server", "libjvm.so");
    expect(await fs.readFile(linkPath, "utf8")).toBe("payload");
  });

  // A repair re-runs materialization over a tree that already has the link. `fs.symlink` fails
  // with EEXIST, so a stale entry has to be removed first or every repair of a Linux/macOS
  // runtime dies on its own previous output.
  it("replaces an existing entry at the link path", async () => {
    await seedFile("lib/libjvm.so", "fresh");
    await seedFile("lib/server/libjvm.so", "stale");

    await materialize({
      files: { "lib/server/libjvm.so": { type: "link", target: "../libjvm.so" } },
    });

    expect(await fs.readFile(path.join(runtimeRoot, "lib", "server", "libjvm.so"), "utf8")).toBe(
      "fresh",
    );
  });

  // Symlink creation needs a privilege or developer mode on Windows, and fails outright on some
  // network filesystems; the copy fallback is what keeps the runtime usable there.
  it("falls back to copying the resolved target when symlink is refused", async () => {
    await seedFile("lib/libjvm.so", "copied-bytes");
    vi.spyOn(fs, "symlink").mockRejectedValue(
      Object.assign(new Error("operation not permitted"), { code: "EPERM" }),
    );

    await materialize({
      files: { "lib/server/libjvm.so": { type: "link", target: "../libjvm.so" } },
    });

    const linkPath = path.join(runtimeRoot, "lib", "server", "libjvm.so");
    expect(await fs.readFile(linkPath, "utf8")).toBe("copied-bytes");
    expect((await fs.lstat(linkPath)).isSymbolicLink()).toBe(false);
  });

  it("reports both failures when the copy fallback also fails", async () => {
    vi.spyOn(fs, "symlink").mockRejectedValue(
      Object.assign(new Error("operation not permitted"), { code: "EPERM" }),
    );

    const failure = await materialize({
      files: { "bin/java-link": { type: "link", target: "./nothing-here" } },
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: MinecraftKitErrorCodes.FILESYSTEM_WRITE_ERROR,
      context: {
        linkTarget: "./nothing-here",
        symlinkError: "operation not permitted",
      },
    });
  });

  it("wraps a non-ENOENT failure while clearing a stale entry", async () => {
    await seedFile("bin/java");
    vi.spyOn(fs, "unlink").mockRejectedValue(
      Object.assign(new Error("device busy"), { code: "EBUSY" }),
    );

    await expect(
      materialize({ files: { "bin/java": { type: "link", target: "./java.real" } } }),
    ).rejects.toMatchObject({ code: MinecraftKitErrorCodes.FILESYSTEM_WRITE_ERROR });
  });

  it("refuses a link entry whose key escapes the runtime root", async () => {
    await expect(
      materialize({ files: { "../../evil": { type: "link", target: "./x" } } }),
    ).rejects.toMatchObject({ code: MinecraftKitErrorCodes.FILESYSTEM_PATH_TRAVERSAL });
  });

  it("leaves plain file entries to the downloader", async () => {
    await materialize({
      files: {
        "bin/java": {
          type: "file",
          executable: false,
          downloads: { raw: { url: "", sha1: "", size: 0 } },
        },
      },
    });

    expect(await fs.stat(path.join(runtimeRoot, "bin", "java")).catch(() => null)).toBeNull();
  });

  it.skipIf(process.platform === "win32")(
    "chmods an executable file entry and swallows a filesystem that ignores mode bits",
    async () => {
      const javaPath = await seedFile("bin/java", "#!/bin/sh\n");
      const executableEntry = {
        files: {
          "bin/java": {
            type: "file",
            executable: true,
            downloads: { raw: { url: "", sha1: "", size: 0 } },
          },
        },
      };

      await materialize(executableEntry);
      expect((await fs.stat(javaPath)).mode & 0o111).not.toBe(0);

      vi.spyOn(fs, "chmod").mockRejectedValue(
        Object.assign(new Error("not supported"), { code: "EPERM" }),
      );
      await expect(materialize(executableEntry)).resolves.toBeUndefined();
    },
  );
});
