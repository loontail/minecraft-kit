import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pickClientJarVersionId } from "../../src/launch/version-resolution";

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
    await placeJar("1.20.1");
    expect(await pickClientJarVersionId(tmpDir, ["1.20.1"])).toBe("1.20.1");
  });

  it("falls back to the parent vanilla id when the loader id has no jar (Fabric)", async () => {
    await placeJar("1.20.1");
    const chain = ["fabric-loader-0.14.21-1.20.1", "1.20.1"];
    expect(await pickClientJarVersionId(tmpDir, chain)).toBe("1.20.1");
  });

  it("prefers the topmost id when its jar exists (legacy Forge with universal jar)", async () => {
    await placeJar("1.12.2-forge-14.23.5");
    await placeJar("1.12.2");
    const chain = ["1.12.2-forge-14.23.5", "1.12.2"];
    expect(await pickClientJarVersionId(tmpDir, chain)).toBe("1.12.2-forge-14.23.5");
  });

  it("falls back to the deepest chain entry when nothing exists yet", async () => {
    const chain = ["fabric-loader-0.14.21-1.20.1", "1.20.1"];
    expect(await pickClientJarVersionId(tmpDir, chain)).toBe("1.20.1");
  });
});
