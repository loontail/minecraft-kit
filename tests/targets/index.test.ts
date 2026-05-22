import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApiEndpoints } from "../../src/constants/api";
import { silentLogger } from "../../src/core/logger";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { createMemoryCache } from "../../src/http/cache";
import { TargetsApi } from "../../src/targets/index";
import { Loaders } from "../../src/types/loader";
import type { RuntimeSystem } from "../../src/types/system";
import { FabricVersionsApi } from "../../src/versions/fabric";
import { ForgeVersionsApi } from "../../src/versions/forge";
import { MinecraftVersionsApi } from "../../src/versions/minecraft";
import { RuntimeVersionsApi } from "../../src/versions/runtime";
import { FakeHttpClient } from "../helpers/fake-http";

const system: RuntimeSystem = { os: "windows", arch: "x64", osVersion: "10.0" };

const buildApis = (): {
  targets: TargetsApi;
  http: FakeHttpClient;
} => {
  const versionRoot = {
    latest: { release: "1.20.1", snapshot: "1.20.1" },
    versions: [
      {
        id: "1.20.1",
        type: "release",
        url: "https://m/1.20.1",
        time: "t",
        releaseTime: "r",
        sha1: "x",
        complianceLevel: 1,
      },
    ],
  };
  const versionManifest = {
    id: "1.20.1",
    type: "release",
    mainClass: "net.minecraft.client.main.Main",
    assetIndex: { id: "5", sha1: "x", size: 1, totalSize: 1, url: "https://a/" },
    assets: "5",
    downloads: { client: { sha1: "x", size: 1, url: "https://c/" } },
    libraries: [],
    javaVersion: { component: "java-runtime-gamma", majorVersion: 17 },
  };
  const runtimeIndex = {
    "windows-x64": {
      "java-runtime-gamma": [
        {
          availability: { group: 1, progress: 100 },
          manifest: { sha1: "x", size: 1, url: "https://m/" },
          version: { name: "17.0.8", released: "2024-01-01" },
        },
      ],
    },
  };
  const http = new FakeHttpClient()
    .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
    .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
    .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) });
  const cache = createMemoryCache();
  const ctx = { http, cache, logger: silentLogger };
  const targets = new TargetsApi({
    minecraft: new MinecraftVersionsApi(ctx),
    fabric: new FabricVersionsApi(ctx),
    forge: new ForgeVersionsApi(ctx),
    runtime: new RuntimeVersionsApi(ctx),
    system,
  });
  return { targets, http };
};

describe("TargetsApi", () => {
  it("create() validates id and directory", () => {
    const { targets } = buildApis();
    expect(() =>
      targets.create({
        id: "",
        directory: "/x",
        minecraft: { version: "1", channel: "release" } as never,
        loader: {
          type: Loaders.VANILLA,
          minecraftVersion: "1",
          minecraft: { version: "1" } as never,
        },
        runtime: {
          component: "x",
          platformKey: "windows-x64",
          versionName: "1",
          system,
          manifestUrl: "x",
          manifestSha1: "x",
        },
      }),
    ).toThrow();
  });

  it("create() rejects relative directories", () => {
    const { targets } = buildApis();
    expect(() =>
      targets.create({
        id: "t",
        directory: "relative/path",
        minecraft: { version: "1", channel: "release" } as never,
        loader: {
          type: Loaders.VANILLA,
          minecraftVersion: "1",
          minecraft: { version: "1" } as never,
        },
        runtime: {
          component: "x",
          platformKey: "windows-x64",
          versionName: "1",
          system,
          manifestUrl: "x",
          manifestSha1: "x",
        },
      }),
    ).toThrow(/absolute path/);
  });

  it("resolve() builds vanilla target", async () => {
    const { targets } = buildApis();
    const target = await targets.resolve({
      id: "t",
      directory: "/x",
      minecraft: { version: asMinecraftVersionId("1.20.1") },
      loader: { type: Loaders.VANILLA },
    });
    expect(target.minecraft.version).toBe("1.20.1");
    expect(target.loader.type).toBe("vanilla");
  });

  it("list() returns empty for missing root", async () => {
    const { targets } = buildApis();
    expect(await targets.list({ rootDir: "/no/such/dir" })).toEqual([]);
  });

  it("list() reports installations", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-list-"));
    try {
      await fs.mkdir(path.join(tmp, "instance-1", "versions", "1.20.1"), { recursive: true });
      await fs.mkdir(path.join(tmp, "instance-1", "libraries"), { recursive: true });
      await fs.mkdir(path.join(tmp, "instance-1", "versions", "fabric-loader-0.15.0-1.20.1"), {
        recursive: true,
      });
      await fs.mkdir(path.join(tmp, "instance-1", "versions", "1.20.1-forge-47.2.0"), {
        recursive: true,
      });
      const { targets } = buildApis();
      const list = await targets.list({ rootDir: tmp });
      expect(list.length).toBe(1);
      expect(list[0]?.minecraftVersions).toContain("1.20.1");
      expect(list[0]?.loaders.find((l) => l.type === "fabric")).toBeTruthy();
      expect(list[0]?.loaders.find((l) => l.type === "forge")).toBeTruthy();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
