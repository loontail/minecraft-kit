import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../../src/core/errors";
import { runProcessor } from "../../src/install/processor";
import { InstallActionKinds, type RunForgeProcessorAction } from "../../src/types/install";
import { FakeSpawner } from "../helpers/fake-spawner";
import { writeFixtureZip } from "../helpers/zip";

const action = (processorJar: string): RunForgeProcessorAction => ({
  kind: InstallActionKinds.RUN_FORGE_PROCESSOR,
  index: 0,
  classpath: [processorJar],
  args: [],
  outputs: {},
});

describe("runProcessor spawn failures", () => {
  let tmpDir: string;
  let processorJar: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-processor-"));
    processorJar = path.join(tmpDir, "processor.jar");
    await writeFixtureZip(processorJar, [
      {
        name: "META-INF/MANIFEST.MF",
        content: "Manifest-Version: 1.0\r\nMain-Class: net.forge.Tool\r\n",
      },
    ]);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Without a settled `exited` promise this test hangs instead of failing: the Forge
  // processor stage has no timeout, so `install.run` / `repair.all` would never resolve.
  it("rejects with the spawner's typed error rather than hanging", async () => {
    const spawnFailure = new MinecraftKitError(
      MinecraftKitErrorCodes.LAUNCH_JAVA_NOT_FOUND,
      "Failed to spawn process: /runtime/bin/java",
    );
    const spawner = new FakeSpawner().push({ exitCode: 0, failWith: spawnFailure });

    await expect(
      runProcessor({
        action: action(processorJar),
        javaPath: "/runtime/bin/java",
        spawner,
        total: 1,
      }),
    ).rejects.toBe(spawnFailure);
  });

  it("still reports a non-zero exit as FORGE_PROCESSOR_FAILED", async () => {
    const spawner = new FakeSpawner().push({ exitCode: 1, stderr: ["boom"] });

    await expect(
      runProcessor({
        action: action(processorJar),
        javaPath: "/runtime/bin/java",
        spawner,
        total: 1,
      }),
    ).rejects.toMatchObject({ code: MinecraftKitErrorCodes.FORGE_PROCESSOR_FAILED });
  });
});
