import { describe, expect, it } from "vitest";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { planFabricInstall } from "../../src/install/fabric-install";
import type { ResolvedFabricLoader } from "../../src/types/fabric";
import { Loaders } from "../../src/types/loader";
import type { ResolvedMinecraft } from "../../src/types/minecraft";
import type { RuntimeSystem } from "../../src/types/system";

const system: RuntimeSystem = { os: "windows", arch: "x64", osVersion: "10.0" };
const MC_1_20_1 = asMinecraftVersionId("1.20.1");

const minecraft: ResolvedMinecraft = {
  version: MC_1_20_1,
  channel: "release",
  manifest: {
    id: MC_1_20_1,
    type: "release",
    mainClass: "x",
    assetIndex: { id: "5", sha1: "x", size: 1, totalSize: 1, url: "" },
    assets: "5",
    downloads: { client: { sha1: "", size: 0, url: "" } },
    libraries: [],
  },
  summary: {
    id: MC_1_20_1,
    type: "release",
    url: "",
    time: "",
    releaseTime: "",
    sha1: "",
    complianceLevel: 1,
  },
};

const loader: ResolvedFabricLoader = {
  type: Loaders.FABRIC,
  minecraftVersion: "1.20.1",
  loaderVersion: "0.14.21",
  profile: {
    id: "fabric-loader-0.14.21-1.20.1",
    inheritsFrom: "1.20.1",
    type: "release",
    mainClass: "fabric.Main",
    libraries: [{ name: "com.example:lib:1.0", url: "https://maven.fabricmc.net/" }],
  },
};

describe("planFabricInstall", () => {
  it("emits versionJson + library downloads", () => {
    const plan = planFabricInstall({
      loader,
      minecraft,
      directory: "/r",
      system,
    });
    expect(plan.versionJson.path).toContain("fabric-loader-0.14.21-1.20.1");
    expect(plan.libraryDownloads.length).toBe(1);
    expect(plan.versionId).toBe("fabric-loader-0.14.21-1.20.1");
  });
});
