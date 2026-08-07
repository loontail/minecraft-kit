import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MinecraftKitErrorCodes } from "../../src/core/errors";
import { materializeRuntimeExtras } from "../../src/install/runtime-extras";
import type { ResolvedRuntime, RuntimeFilesManifest } from "../../src/types/runtime";

const runtime: ResolvedRuntime = {
  component: "java-runtime-gamma",
  platformKey: "windows-x64",
  versionName: "17",
  system: { os: "windows", arch: "x64", osVersion: "10" },
  manifestUrl: "https://m/",
  manifestSha1: "x",
};

// The runtime files manifest is remote JSON and its keys are write destinations, so a `../` key
// would mkdir/symlink outside the runtime root.
describe("materializeRuntimeExtras — containment", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-runtime-extras-"));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  const materialize = (manifest: RuntimeFilesManifest) =>
    materializeRuntimeExtras({ runtime, directory, manifest });

  it("refuses a directory entry that escapes the runtime root", async () => {
    const escaping = { files: { "../../escaped": { type: "directory" } } } as RuntimeFilesManifest;

    await expect(materialize(escaping)).rejects.toMatchObject({
      code: MinecraftKitErrorCodes.FILESYSTEM_PATH_TRAVERSAL,
    });
    // `../../` from `<directory>/runtime/<component>` lands back on `<directory>` — outside the
    // runtime root, which is the boundary being enforced.
    expect(await fs.stat(path.join(directory, "escaped")).catch(() => null)).toBeNull();
  });

  it("materializes an in-tree directory entry", async () => {
    await materialize({ files: { "lib/ext": { type: "directory" } } } as RuntimeFilesManifest);

    const created = await fs.stat(path.join(directory, "runtime", runtime.component, "lib", "ext"));
    expect(created.isDirectory()).toBe(true);
  });
});
