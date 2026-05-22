import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { pickClientJarVersionId } from "../../src/launch/version-resolution";

const MC_1_20_1 = asMinecraftVersionId("1.20.1");
const FABRIC_1_20_1 = asMinecraftVersionId("fabric-loader-0.14.21-1.20.1");
const FORGE_1_12_2 = asMinecraftVersionId("1.12.2-forge-14.23.5");
const MC_1_12_2 = asMinecraftVersionId("1.12.2");

describe("pickClientJarVersionId", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-pickjar-"));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function placeJar(versionId: string): Promise<void> {
    const dir = path.join(tmpDir, "versions", versionId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${versionId}.jar`), "fake");
  }

  it("returns the topmost id whose jar exists (vanilla)", async () => {
    await placeJar(MC_1_20_1);
    expect(await pickClientJarVersionId(tmpDir, [MC_1_20_1])).toBe(MC_1_20_1);
  });

  it("falls back to the parent vanilla id when the loader id has no jar (Fabric)", async () => {
    await placeJar(MC_1_20_1);
    const chain = [FABRIC_1_20_1, MC_1_20_1];
    expect(await pickClientJarVersionId(tmpDir, chain)).toBe(MC_1_20_1);
  });

  it("prefers the topmost id when its jar exists (legacy Forge with universal jar)", async () => {
    await placeJar(FORGE_1_12_2);
    await placeJar(MC_1_12_2);
    const chain = [FORGE_1_12_2, MC_1_12_2];
    expect(await pickClientJarVersionId(tmpDir, chain)).toBe(FORGE_1_12_2);
  });

  it("falls back to the deepest chain entry when nothing exists yet", async () => {
    const chain = [FABRIC_1_20_1, MC_1_20_1];
    expect(await pickClientJarVersionId(tmpDir, chain)).toBe(MC_1_20_1);
  });
});
