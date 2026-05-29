import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { pickClientJarVersionId, resolveLaunchVersion } from "../../src/launch/version-resolution";
import { Loaders } from "../../src/types/loader";
import type { MinecraftVersionManifest, ResolvedMinecraft } from "../../src/types/minecraft";
import type { Target } from "../../src/types/target";

const MC_1_20_1 = asMinecraftVersionId("1.20.1");
const FABRIC_1_20_1 = asMinecraftVersionId("fabric-loader-0.14.21-1.20.1");
const FORGE_1_12_2 = asMinecraftVersionId("1.12.2-forge-14.23.5");
const MC_1_12_2 = asMinecraftVersionId("1.12.2");
const MC_1_7_10 = asMinecraftVersionId("1.7.10");
const FORGE_1_7_10_LEGACY = asMinecraftVersionId("1.7.10-Forge10.13.4.1614-1.7.10");

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

  async function placeVersionJson(versionId: string, manifest: MinecraftVersionManifest) {
    const dir = path.join(tmpDir, "versions", versionId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${versionId}.json`), JSON.stringify(manifest));
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

  it("resolves legacy Forge version JSON with an uppercase Forge id", async () => {
    const parentManifest = manifest(MC_1_7_10);
    const forgeManifest: MinecraftVersionManifest = {
      id: FORGE_1_7_10_LEGACY,
      type: "release",
      mainClass: "net.minecraft.launchwrapper.Launch",
      inheritsFrom: MC_1_7_10,
      libraries: [{ name: "net.minecraftforge:forge:1.7.10-10.13.4.1614-1.7.10" }],
      minecraftArguments: "--username ${auth_player_name}",
      assetIndex: parentManifest.assetIndex,
      assets: parentManifest.assets,
      downloads: parentManifest.downloads,
    };
    await placeVersionJson(FORGE_1_7_10_LEGACY, forgeManifest);

    const target = {
      id: "legacy-forge",
      directory: tmpDir,
      minecraft: resolvedMinecraft(MC_1_7_10, parentManifest),
      loader: {
        type: Loaders.FORGE,
        minecraftVersion: "1.7.10",
        forgeVersion: "10.13.4.1614-1.7.10",
        fullVersion: "1.7.10-10.13.4.1614-1.7.10",
        installerUrl: "https://forge/installer.jar",
      },
      runtime: {
        component: "jre-legacy",
        versionName: "8u51",
        majorVersion: 8,
        platformKey: "windows-x64",
        system: { os: "windows", arch: "x64", osVersion: "10.0" },
      },
    } as Target;

    await expect(resolveLaunchVersion(target)).resolves.toMatchObject({
      versionId: FORGE_1_7_10_LEGACY,
      chain: [FORGE_1_7_10_LEGACY, MC_1_7_10],
      merged: { mainClass: "net.minecraft.launchwrapper.Launch" },
    });
  });
});

const manifest = (id: typeof MC_1_7_10): MinecraftVersionManifest => ({
  id,
  type: "release",
  mainClass: "net.minecraft.client.main.Main",
  assetIndex: { id, sha1: "x", size: 1, totalSize: 1, url: "https://assets/index" },
  assets: id,
  downloads: { client: { sha1: "x", size: 1, url: "https://client.jar" } },
  libraries: [],
});

const resolvedMinecraft = (
  version: typeof MC_1_7_10,
  versionManifest: MinecraftVersionManifest,
): ResolvedMinecraft => ({
  version,
  channel: "release",
  manifest: versionManifest,
  summary: {
    id: version,
    type: "release",
    url: "",
    time: "",
    releaseTime: "",
    sha1: "",
    complianceLevel: 0,
  },
});
