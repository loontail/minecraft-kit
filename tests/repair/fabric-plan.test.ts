import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApiEndpoints } from "../../src/constants/api";
import { targetPaths } from "../../src/core/paths";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { createMemoryCache } from "../../src/http/cache";
import { planFabricRepair } from "../../src/repair/fabric";
import type { ResolvedFabricLoader } from "../../src/types/fabric";
import { InstallActionKinds } from "../../src/types/install";
import { Loaders } from "../../src/types/loader";
import type { ResolvedMinecraft } from "../../src/types/minecraft";
import type { RuntimeSystem } from "../../src/types/system";
import type { Target } from "../../src/types/target";
import {
  VerificationKinds,
  type VerificationResult,
  VerifyFileCategories,
  type VerifyFileCategory,
  VerifyFileStatuses,
} from "../../src/types/verify";
import { FakeHttpClient } from "../helpers/fake-http";

const DIRECTORY = path.join(path.sep, "fabric-root");
const FABRIC_PROFILE_ID = "fabric-loader-0.14.21-1.20.1";
const FABRIC_LIB_MAVEN = "https://maven.fabricmc.net/";
const system: RuntimeSystem = { os: "windows", arch: "x64", osVersion: "10.0" };
const MC = asMinecraftVersionId("1.20.1");

const minecraft: ResolvedMinecraft = {
  version: MC,
  channel: "release",
  manifest: {
    id: MC,
    type: "release",
    mainClass: "net.minecraft.client.main.Main",
    assetIndex: { id: "5", sha1: "idx-sha", size: 14, totalSize: 14, url: "https://idx/" },
    assets: "5",
    downloads: { client: { sha1: "client-sha", size: 6, url: "https://client/" } },
    libraries: [],
    javaVersion: { component: "java-runtime-gamma", majorVersion: 17 },
  },
  summary: {
    id: MC,
    type: "release",
    url: "https://m/1.20.1",
    time: "t",
    releaseTime: "r",
    sha1: "x",
    complianceLevel: 1,
  },
};

const loader: ResolvedFabricLoader = {
  type: Loaders.FABRIC,
  minecraftVersion: "1.20.1",
  loaderVersion: "0.14.21",
  profile: {
    id: FABRIC_PROFILE_ID,
    inheritsFrom: "1.20.1",
    type: "release",
    mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
    libraries: [
      { name: "net.fabricmc:fabric-loader:0.14.21", url: FABRIC_LIB_MAVEN },
      { name: "net.fabricmc:tiny-mappings-parser:0.3.0", url: FABRIC_LIB_MAVEN },
    ],
  },
};

const target: Target = {
  id: "fabric-target",
  directory: DIRECTORY,
  minecraft,
  loader,
  runtime: {
    component: "java-runtime-gamma",
    platformKey: "windows-x64",
    versionName: "17.0.8",
    majorVersion: 17,
    system,
    manifestUrl: "https://rm/",
    manifestSha1: "x",
  },
};

const fabricJsonPath = targetPaths.versionJson(DIRECTORY, FABRIC_PROFILE_ID);
const minecraftJsonPath = targetPaths.versionJson(DIRECTORY, MC);
const clientJarPath = targetPaths.versionJar(DIRECTORY, MC);
const fabricLoaderJar = path.join(
  DIRECTORY,
  "libraries",
  "net",
  "fabricmc",
  "fabric-loader",
  "0.14.21",
  "fabric-loader-0.14.21.jar",
);

const http = (): FakeHttpClient =>
  new FakeHttpClient()
    .on(ApiEndpoints.mojang.versionManifest(), {
      body: JSON.stringify({
        latest: { release: "1.20.1", snapshot: "1.20.1" },
        versions: [minecraft.summary],
      }),
    })
    .on("https://m/1.20.1", { body: JSON.stringify(minecraft.manifest) })
    .on("https://idx/", { body: '{"objects":{}}' })
    .on("https://rm/", { body: '{"files":{}}' });

const verification = (
  issues: readonly { path: string; category: VerifyFileCategory }[],
): VerificationResult => ({
  targetId: target.id,
  kind: VerificationKinds.FABRIC,
  isValid: issues.length === 0,
  issues: issues.map((issue) => ({ ...issue, status: VerifyFileStatuses.MISSING })),
  checkedFiles: issues.length,
  durationMs: 1,
});

const plan = async (result: VerificationResult) =>
  await planFabricRepair({ target, http: http(), cache: createMemoryCache(), from: result });

describe("planFabricRepair", () => {
  it("re-downloads only the Fabric libraries reported broken", async () => {
    const repair = await plan(
      verification([{ path: fabricLoaderJar, category: VerifyFileCategories.LOADER_LIBRARY }]),
    );

    expect(repair.actions).toHaveLength(1);
    expect(repair.actions[0]).toMatchObject({
      kind: InstallActionKinds.DOWNLOAD_FILE,
      target: fabricLoaderJar,
    });
    expect(repair.targetId).toBe(target.id);
    expect(repair.totalActions).toBe(1);
  });

  it("rewrites the Fabric profile JSON when it is the reported issue", async () => {
    const repair = await plan(
      verification([{ path: fabricJsonPath, category: VerifyFileCategories.LOADER_LIBRARY }]),
    );

    expect(repair.actions).toEqual([
      expect.objectContaining({
        kind: InstallActionKinds.WRITE_VERSION_JSON,
        path: fabricJsonPath,
      }),
    ]);
  });

  // The vanilla version JSON lives at a different path in the same versions/ tree. Matching by
  // action kind alone would make repair.fabric rewrite the Minecraft manifest, which belongs to
  // the minecraft aspect — and on a Fabric install the two JSONs are not interchangeable.
  it("leaves the Minecraft version JSON to the minecraft aspect", async () => {
    const repair = await plan(
      verification([{ path: minecraftJsonPath, category: VerifyFileCategories.CLIENT_JAR }]),
    );

    expect(repair.actions).toEqual([]);
    expect(repair.totalActions).toBe(0);
  });

  it("ignores a broken client jar", async () => {
    const repair = await plan(
      verification([{ path: clientJarPath, category: VerifyFileCategories.CLIENT_JAR }]),
    );

    expect(repair.actions).toEqual([]);
  });

  it("plans nothing for a valid Fabric slice", async () => {
    const repair = await plan(verification([]));

    expect(repair.actions).toEqual([]);
    expect(repair.totalBytes).toBe(0);
  });

  it("rejects a non-Fabric target with INVALID_INPUT", async () => {
    await expect(
      planFabricRepair({
        target: {
          ...target,
          loader: { type: Loaders.VANILLA, minecraftVersion: "1.20.1", minecraft },
        },
        http: http(),
        cache: createMemoryCache(),
        from: verification([]),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
