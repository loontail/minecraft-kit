import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApiEndpoints } from "../../src/constants/api";
import { NODE_PLATFORM_TO_MOJANG_OS } from "../../src/constants/platform";
import { MinecraftKitErrorCodes } from "../../src/core/errors";
import { silentLogger } from "../../src/core/logger";
import { javaExecutableUnder, targetPaths } from "../../src/core/paths";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { createMemoryCache } from "../../src/http/cache";
import { TargetsApi } from "../../src/targets/index";
import { Loaders } from "../../src/types/loader";
import type { ResolvedMinecraft } from "../../src/types/minecraft";
import { RuntimePreference } from "../../src/types/runtime";
import type { RuntimeSystem } from "../../src/types/system";
import { FabricVersionsApi } from "../../src/versions/fabric";
import { ForgeVersionsApi } from "../../src/versions/forge";
import { MinecraftVersionsApi } from "../../src/versions/minecraft";
import { RuntimeVersionsApi } from "../../src/versions/runtime";
import { FakeHttpClient } from "../helpers/fake-http";

const system: RuntimeSystem = { os: "windows", arch: "x64", osVersion: "10.0" };
const HOST_OS = NODE_PLATFORM_TO_MOJANG_OS[process.platform as "win32" | "darwin" | "linux"];

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
        manifest: { sha1: "x", size: 1, url: "https://gamma/" },
        version: { name: "17.0.8", released: "2024-01-01" },
      },
    ],
    "java-runtime-delta": [
      {
        availability: { group: 1, progress: 100 },
        manifest: { sha1: "x", size: 1, url: "https://delta/" },
        version: { name: "21.0.3", released: "2024-06-01" },
      },
    ],
  },
};

const fabricLoaders = [
  { loader: { version: "0.14.21", stable: true, maven: "m", build: 1, separator: "." } },
];
const fabricProfile = {
  id: "fabric-loader-0.14.21-1.20.1",
  inheritsFrom: "1.20.1",
  type: "release",
  mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
  libraries: [],
};

const forgePromotions = { promos: { "1.20.1-recommended": "47.2.0", "1.20.1-latest": "47.2.5" } };
const forgeMavenMetadata = `<?xml version="1.0" encoding="UTF-8"?>
<metadata><versioning><versions>
  <version>1.20.1-47.2.0</version>
  <version>1.20.1-47.2.5</version>
</versions></versioning></metadata>`;

const buildTargets = (): TargetsApi => {
  const http = new FakeHttpClient()
    .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
    .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) })
    .on(ApiEndpoints.mojang.runtimeIndex(), { body: JSON.stringify(runtimeIndex) })
    .on(ApiEndpoints.fabric.loaderForGame("1.20.1"), { body: JSON.stringify(fabricLoaders) })
    .on(ApiEndpoints.fabric.profile("1.20.1", "0.14.21"), {
      body: JSON.stringify(fabricProfile),
    })
    .on(ApiEndpoints.forge.promotions(), { body: JSON.stringify(forgePromotions) })
    .on(ApiEndpoints.forge.mavenMetadata(), { body: forgeMavenMetadata });
  const ctx = { http, cache: createMemoryCache(), logger: silentLogger };
  return new TargetsApi({
    minecraft: new MinecraftVersionsApi(ctx),
    fabric: new FabricVersionsApi(ctx),
    forge: new ForgeVersionsApi(ctx),
    runtime: new RuntimeVersionsApi(ctx),
    system,
  });
};

const minimalMinecraft = (version = "1.20.1"): ResolvedMinecraft =>
  ({
    version: asMinecraftVersionId(version),
    channel: "release",
    manifest: { ...versionManifest, id: asMinecraftVersionId(version) },
    summary: versionRoot.versions[0],
  }) as unknown as ResolvedMinecraft;

const runtime = {
  component: "java-runtime-gamma",
  platformKey: "windows-x64" as const,
  versionName: "17.0.8",
  system,
  manifestUrl: "https://gamma/",
  manifestSha1: "x",
};

describe("TargetsApi.create rejections", () => {
  it("rejects an empty directory", () => {
    expect(() =>
      buildTargets().create({
        id: "t",
        directory: "",
        minecraft: minimalMinecraft(),
        loader: {
          type: Loaders.VANILLA,
          minecraftVersion: "1.20.1",
          minecraft: minimalMinecraft(),
        },
        runtime,
      }),
    ).toThrow(/directory must be non-empty/);
  });

  // A loader resolved for a different Minecraft version silently produces an install whose
  // version JSON `inheritsFrom` points at a manifest that is not there.
  it("rejects a loader resolved against a different Minecraft version", () => {
    let caught: unknown;
    try {
      buildTargets().create({
        id: "t",
        directory: path.join(path.sep, "games", "t"),
        minecraft: minimalMinecraft("1.20.1"),
        loader: {
          type: Loaders.VANILLA,
          minecraftVersion: "1.19.4",
          minecraft: minimalMinecraft("1.19.4"),
        },
        runtime,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: MinecraftKitErrorCodes.INVALID_INPUT,
      context: { loaderMinecraft: "1.19.4", minecraftVersion: "1.20.1" },
    });
  });

  it("exposes the detected system it resolves against", () => {
    expect(buildTargets().system).toEqual(system);
  });
});

describe("TargetsApi.resolve loader branches", () => {
  it("resolves a Fabric target through the Fabric versions api", async () => {
    const target = await buildTargets().resolve({
      id: "fab",
      directory: path.join(path.sep, "games", "fab"),
      minecraft: { version: asMinecraftVersionId("1.20.1") },
      loader: { type: Loaders.FABRIC, version: "0.14.21" },
    });

    expect(target.loader).toMatchObject({
      type: Loaders.FABRIC,
      loaderVersion: "0.14.21",
      minecraftVersion: "1.20.1",
    });
  });

  it("resolves a Forge target through the Forge versions api", async () => {
    const target = await buildTargets().resolve({
      id: "forge",
      directory: path.join(path.sep, "games", "forge"),
      minecraft: { version: asMinecraftVersionId("1.20.1") },
      loader: { type: Loaders.FORGE, version: "47.2.0" },
    });

    expect(target.loader).toMatchObject({
      type: Loaders.FORGE,
      forgeVersion: "47.2.0",
      fullVersion: "1.20.1-47.2.0",
    });
  });

  it("honours a runtime component override instead of the manifest's javaVersion", async () => {
    const target = await buildTargets().resolve({
      id: "delta",
      directory: path.join(path.sep, "games", "delta"),
      minecraft: { version: asMinecraftVersionId("1.20.1") },
      loader: { type: Loaders.VANILLA },
      runtime: { component: "java-runtime-delta", preference: RuntimePreference.LATEST },
    });

    expect(target.runtime.component).toBe("java-runtime-delta");
    expect(target.runtime.versionName).toBe("21.0.3");
  });

  it("carries a custom runtime installRoot onto the resolved target", async () => {
    const installRoot = path.join(path.sep, "shared", "runtimes");
    const target = await buildTargets().resolve({
      id: "shared",
      directory: path.join(path.sep, "games", "shared"),
      minecraft: { version: asMinecraftVersionId("1.20.1") },
      loader: { type: Loaders.VANILLA },
      runtime: { installRoot },
    });

    expect(target.runtime.installRoot).toBe(installRoot);
  });

  it("resolves against a caller-supplied system rather than the detected one", async () => {
    const linux: RuntimeSystem = { os: "linux", arch: "x64", osVersion: "6.1" };
    const targets = new TargetsApi({
      minecraft: new MinecraftVersionsApi({
        http: new FakeHttpClient()
          .on(ApiEndpoints.mojang.versionManifest(), { body: JSON.stringify(versionRoot) })
          .on("https://m/1.20.1", { body: JSON.stringify(versionManifest) }),
        cache: createMemoryCache(),
        logger: silentLogger,
      }),
      fabric: new FabricVersionsApi({
        http: new FakeHttpClient(),
        cache: createMemoryCache(),
        logger: silentLogger,
      }),
      forge: new ForgeVersionsApi({
        http: new FakeHttpClient(),
        cache: createMemoryCache(),
        logger: silentLogger,
      }),
      runtime: new RuntimeVersionsApi({
        http: new FakeHttpClient().on(ApiEndpoints.mojang.runtimeIndex(), {
          body: JSON.stringify({ linux: runtimeIndex["windows-x64"] }),
        }),
        cache: createMemoryCache(),
        logger: silentLogger,
      }),
      system,
    });

    const target = await targets.resolve({
      id: "lin",
      directory: path.join(path.sep, "games", "lin"),
      minecraft: { version: asMinecraftVersionId("1.20.1") },
      loader: { type: Loaders.VANILLA },
      system: linux,
    });

    expect(target.runtime.platformKey).toBe("linux");
    expect(target.runtime.system).toEqual(linux);
  });
});

describe("TargetsApi.list discovery", () => {
  const roots: string[] = [];

  const makeRoot = async (): Promise<string> => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-discover-"));
    roots.push(root);
    return root;
  };

  afterEach(async () => {
    for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
  });

  it("skips a directory that has versions/ but neither libraries/ nor assets/", async () => {
    const root = await makeRoot();
    await fs.mkdir(targetPaths.versionsDir(path.join(root, "half")), { recursive: true });

    expect(await buildTargets().list({ rootDir: root })).toEqual([]);
  });

  it("accepts assets/ alone as evidence of an install", async () => {
    const root = await makeRoot();
    const install = path.join(root, "assets-only");
    await fs.mkdir(path.join(targetPaths.versionsDir(install), "1.20.1"), { recursive: true });
    await fs.mkdir(targetPaths.assetsDir(install), { recursive: true });

    const found = await buildTargets().list({ rootDir: root });

    expect(found).toHaveLength(1);
    expect(found[0]?.minecraftVersions).toEqual(["1.20.1"]);
  });

  // Two loaders on the same Minecraft version must not list "1.20.1" twice — the CLI renders
  // this list verbatim.
  it("deduplicates the Minecraft version two loader directories agree on", async () => {
    const root = await makeRoot();
    const install = path.join(root, "modded");
    for (const versionId of [
      "fabric-loader-0.14.21-1.20.1",
      "fabric-loader-0.15.0-1.20.1",
      "1.20.1-forge-47.2.0",
    ]) {
      await fs.mkdir(path.join(targetPaths.versionsDir(install), versionId), { recursive: true });
    }
    await fs.mkdir(targetPaths.librariesDir(install), { recursive: true });

    const found = await buildTargets().list({ rootDir: root });

    expect(found[0]?.minecraftVersions).toEqual(["1.20.1"]);
    expect(found[0]?.loaders).toHaveLength(3);
  });

  it("reports no runtime hint when runtime/ is absent", async () => {
    const root = await makeRoot();
    const install = path.join(root, "no-runtime");
    await fs.mkdir(path.join(targetPaths.versionsDir(install), "1.20.1"), { recursive: true });
    await fs.mkdir(targetPaths.librariesDir(install), { recursive: true });

    const found = await buildTargets().list({ rootDir: root });

    expect(found[0]?.runtime).toBeUndefined();
  });

  it("reports no runtime hint when a component directory holds no java binary", async () => {
    const root = await makeRoot();
    const install = path.join(root, "empty-component");
    await fs.mkdir(path.join(targetPaths.versionsDir(install), "1.20.1"), { recursive: true });
    await fs.mkdir(targetPaths.librariesDir(install), { recursive: true });
    await fs.mkdir(path.join(targetPaths.runtimesDir(install), "java-runtime-gamma"), {
      recursive: true,
    });

    const found = await buildTargets().list({ rootDir: root });

    expect(found[0]?.runtime).toBeUndefined();
  });

  it.skipIf(HOST_OS === undefined)(
    "reports the first component whose java binary exists on the host layout",
    async () => {
      const root = await makeRoot();
      const install = path.join(root, "with-runtime");
      await fs.mkdir(path.join(targetPaths.versionsDir(install), "1.20.1"), { recursive: true });
      await fs.mkdir(targetPaths.librariesDir(install), { recursive: true });
      const runtimesDir = targetPaths.runtimesDir(install);
      // `aaa-empty` sorts first and has no binary: discovery must keep scanning past it.
      await fs.mkdir(path.join(runtimesDir, "aaa-empty"), { recursive: true });
      const javaPath = javaExecutableUnder(
        path.join(runtimesDir, "java-runtime-gamma"),
        HOST_OS as "windows" | "osx" | "linux",
      );
      await fs.mkdir(path.dirname(javaPath), { recursive: true });
      await fs.writeFile(javaPath, "java");

      const found = await buildTargets().list({ rootDir: root });

      expect(found[0]?.runtime).toEqual({ component: "java-runtime-gamma", javaPath });
    },
  );

  it("reports no runtime hint on a host platform Mojang publishes no runtimes for", async () => {
    const root = await makeRoot();
    const install = path.join(root, "exotic");
    await fs.mkdir(path.join(targetPaths.versionsDir(install), "1.20.1"), { recursive: true });
    await fs.mkdir(targetPaths.librariesDir(install), { recursive: true });
    const javaPath = javaExecutableUnder(
      path.join(targetPaths.runtimesDir(install), "java-runtime-gamma"),
      "linux",
    );
    await fs.mkdir(path.dirname(javaPath), { recursive: true });
    await fs.writeFile(javaPath, "java");

    const original = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "sunos", configurable: true });
    try {
      const found = await buildTargets().list({ rootDir: root });
      expect(found[0]?.runtime).toBeUndefined();
    } finally {
      if (original) Object.defineProperty(process, "platform", original);
    }
  });
});
