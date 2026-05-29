import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { targetPaths } from "../../src/core/paths";
import { launchPreflight } from "../../src/launch/preflight";
import { Loaders } from "../../src/types/loader";
import type { Target } from "../../src/types/target";
import { fakeTarget } from "../helpers/fake-kit";

const writeFile = async (filePath: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "x");
};

const vanillaLaunchFiles = (target: Target): readonly [string, string, string] => [
  targetPaths.runtimeJavaExecutable(
    target.directory,
    target.runtime.component,
    target.runtime.system.os,
    target.runtime.installRoot,
  ),
  targetPaths.versionJson(target.directory, target.minecraft.version),
  targetPaths.versionJar(target.directory, target.minecraft.version),
];

describe("launchPreflight", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-preflight-"));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reports ok when every launch-critical file is present", async () => {
    const target: Target = { ...fakeTarget, directory: tmpDir };
    for (const filePath of vanillaLaunchFiles(target)) await writeFile(filePath);
    const result = await launchPreflight(target);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("lists every missing launch-critical file when nothing is installed", async () => {
    const target: Target = { ...fakeTarget, directory: tmpDir };
    const result = await launchPreflight(target);
    expect(result.ok).toBe(false);
    expect(new Set(result.missing)).toEqual(new Set(vanillaLaunchFiles(target)));
  });

  it("reports only the missing files when the install is partial", async () => {
    const target: Target = { ...fakeTarget, directory: tmpDir };
    const files = vanillaLaunchFiles(target);
    await writeFile(files[0]);
    await writeFile(files[1]);
    const result = await launchPreflight(target);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([files[2]]);
  });

  it("surfaces the loader version JSON when resolution fails for a Forge target", async () => {
    const target: Target = {
      ...fakeTarget,
      directory: tmpDir,
      loader: {
        type: Loaders.FORGE,
        minecraftVersion: "1.20.1",
        forgeVersion: "47.2.0",
        fullVersion: "1.20.1-47.2.0",
        installerUrl: "https://maven.minecraftforge.net/installer.jar",
      },
    };
    const result = await launchPreflight(target);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain(targetPaths.versionJson(tmpDir, "1.20.1-47.2.0"));
  });
});
