import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { composeLaunch } from "../../src/launch/compose";
import { AuthModes } from "../../src/types/auth";
import type { ResolvedFabricLoader } from "../../src/types/fabric";
import { Loaders } from "../../src/types/loader";
import type { ResolvedMinecraft } from "../../src/types/minecraft";
import type { ResolvedRuntime } from "../../src/types/runtime";
import type { Target } from "../../src/types/target";

const minecraft: ResolvedMinecraft = {
  version: "1.20.1",
  channel: "release",
  manifest: {
    id: "1.20.1",
    type: "release",
    mainClass: "net.minecraft.client.main.Main",
    assetIndex: { id: "5", sha1: "x", size: 1, totalSize: 1, url: "https://idx" },
    assets: "5",
    downloads: { client: { sha1: "x", size: 1, url: "https://c" } },
    libraries: [],
    arguments: { game: ["--username", "${auth_player_name}"], jvm: [] },
  },
  summary: {
    id: "1.20.1",
    type: "release",
    url: "https://m",
    time: "",
    releaseTime: "2023-06-01T00:00:00+00:00",
    sha1: "x",
    complianceLevel: 1,
  },
};

const runtime: ResolvedRuntime = {
  component: "java-runtime-gamma",
  platformKey: "windows-x64",
  versionName: "17.0.8",
  system: { os: "windows", arch: "x64", osVersion: "10.0" },
  manifestUrl: "https://rm",
  manifestSha1: "x",
};

const fabricLoader: ResolvedFabricLoader = {
  type: Loaders.FABRIC,
  minecraftVersion: "1.20.1",
  loaderVersion: "0.14.21",
  profile: {
    id: "fabric-loader-0.14.21-1.20.1",
    inheritsFrom: "1.20.1",
    type: "release",
    mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
    libraries: [],
  },
};

describe("composeLaunch (Fabric regression)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-compose-"));
    await stageFabricLayoutWithoutFabricJar(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("puts the vanilla client jar on the classpath, not the (non-existent) fabric jar", async () => {
    const target: Target = {
      id: "demo-fabric",
      directory: tmpDir,
      minecraft,
      loader: fabricLoader,
      runtime,
    };
    const composition = await composeLaunch({
      target,
      options: { auth: { mode: AuthModes.OFFLINE, username: "Player" } },
    });
    const cp = composition.classpath;
    const vanillaJar = path.join(tmpDir, "versions", "1.20.1", "1.20.1.jar");
    const fabricJar = path.join(
      tmpDir,
      "versions",
      "fabric-loader-0.14.21-1.20.1",
      "fabric-loader-0.14.21-1.20.1.jar",
    );
    expect(cp).toContain(vanillaJar);
    expect(cp).not.toContain(fabricJar);
    expect(composition.mainClass).toBe("net.fabricmc.loader.impl.launch.knot.KnotClient");
    const game = composition.gameArgs.join(" ");
    expect(game).toContain("Player");
  });
});

/**
 * Stage the on-disk layout for the regression: vanilla `.jar` exists, Fabric profile
 * JSON exists, Fabric `.jar` is deliberately missing (the bug we are guarding against).
 */
const stageFabricLayoutWithoutFabricJar = async (tmpDir: string): Promise<void> => {
  const vanillaDir = path.join(tmpDir, "versions", "1.20.1");
  await fs.mkdir(vanillaDir, { recursive: true });
  await fs.writeFile(path.join(vanillaDir, "1.20.1.jar"), "vanilla-bytes");

  const fabricDir = path.join(tmpDir, "versions", "fabric-loader-0.14.21-1.20.1");
  await fs.mkdir(fabricDir, { recursive: true });
  await fs.writeFile(
    path.join(fabricDir, "fabric-loader-0.14.21-1.20.1.json"),
    JSON.stringify(fabricLoader.profile),
  );
};
