import { describe, expect, it } from "vitest";
import {
  isForgeInstallerProfileShape,
  isForgeInstallProfileShape,
  isForgeVersionJsonShape,
  isLegacyForgeInstallProfileShape,
} from "../../src/install/forge-installer-archive";

describe("isForgeInstallProfileShape", () => {
  const valid = {
    spec: 1,
    profile: "forge",
    version: "1.20.1-forge-47.2.0",
    minecraft: "1.20.1",
    json: "/version.json",
    data: {
      MAPPINGS: { client: "[de.oceanlabs:mcp:client]", server: "[de.oceanlabs:mcp:server]" },
    },
    libraries: [{ name: "com.example:lib:1.0" }],
    processors: [
      {
        jar: "com.example:processor:1.0",
        classpath: ["com.example:lib:1.0"],
        args: ["--task", "MCP_DATA"],
      },
    ],
  };

  it("accepts a well-shaped install profile", () => {
    expect(isForgeInstallProfileShape(valid)).toBe(true);
  });

  it("accepts empty libraries and processors arrays", () => {
    expect(isForgeInstallProfileShape({ ...valid, libraries: [], processors: [] })).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(isForgeInstallProfileShape(null)).toBe(false);
    expect(isForgeInstallProfileShape([])).toBe(false);
    expect(isForgeInstallProfileShape("profile")).toBe(false);
  });

  it("rejects missing spec / json / data", () => {
    expect(isForgeInstallProfileShape({ ...valid, spec: "1" })).toBe(false);
    expect(isForgeInstallProfileShape({ ...valid, json: "" })).toBe(false);
    expect(isForgeInstallProfileShape({ ...valid, data: null })).toBe(false);
  });

  it("rejects non-array libraries / processors", () => {
    expect(isForgeInstallProfileShape({ ...valid, libraries: {} })).toBe(false);
    expect(isForgeInstallProfileShape({ ...valid, processors: {} })).toBe(false);
  });

  it("rejects a processor missing jar / classpath / args", () => {
    expect(
      isForgeInstallProfileShape({
        ...valid,
        processors: [{ classpath: [], args: [] }],
      }),
    ).toBe(false);
    expect(
      isForgeInstallProfileShape({
        ...valid,
        processors: [{ jar: "x", args: [] }],
      }),
    ).toBe(false);
    expect(
      isForgeInstallProfileShape({
        ...valid,
        processors: [{ jar: "x", classpath: [] }],
      }),
    ).toBe(false);
  });
});

describe("isLegacyForgeInstallProfileShape", () => {
  const legacy = {
    install: {
      profileName: "Forge",
      target: "1.7.10-Forge10.13.4.1614-1.7.10",
      path: "net.minecraftforge:forge:1.7.10-10.13.4.1614-1.7.10",
      version: "Forge 10.13.4.1614-1.7.10",
      filePath: "forge-1.7.10-10.13.4.1614-1.7.10-universal.jar",
      minecraft: "1.7.10",
    },
    versionInfo: {
      id: "1.7.10-Forge10.13.4.1614-1.7.10",
      inheritsFrom: "1.7.10",
      type: "release",
      mainClass: "net.minecraft.launchwrapper.Launch",
      minecraftArguments: "--username ${auth_player_name}",
      libraries: [{ name: "net.minecraftforge:forge:1.7.10-10.13.4.1614-1.7.10" }],
    },
  };

  it("accepts a legacy 1.7.x install profile", () => {
    expect(isLegacyForgeInstallProfileShape(legacy)).toBe(true);
    expect(isForgeInstallerProfileShape(legacy)).toBe(true);
  });

  it("keeps the modern guard scoped to spec/json profiles", () => {
    expect(isForgeInstallProfileShape(legacy)).toBe(false);
  });

  it("rejects legacy profiles missing the embedded universal jar path", () => {
    expect(
      isLegacyForgeInstallProfileShape({
        ...legacy,
        install: { ...legacy.install, filePath: "" },
      }),
    ).toBe(false);
  });
});

describe("isForgeVersionJsonShape", () => {
  const valid = {
    id: "1.20.1-forge-47.2.0",
    inheritsFrom: "1.20.1",
    type: "release",
    mainClass: "cpw.mods.bootstraplauncher.BootstrapLauncher",
    libraries: [{ name: "com.example:lib:1.0" }],
  };

  it("accepts a well-shaped version JSON", () => {
    expect(isForgeVersionJsonShape(valid)).toBe(true);
  });

  it("accepts empty libraries", () => {
    expect(isForgeVersionJsonShape({ ...valid, libraries: [] })).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(isForgeVersionJsonShape(null)).toBe(false);
    expect(isForgeVersionJsonShape([])).toBe(false);
  });

  it("rejects missing id / mainClass / inheritsFrom", () => {
    expect(isForgeVersionJsonShape({ ...valid, id: "" })).toBe(false);
    expect(isForgeVersionJsonShape({ ...valid, mainClass: "" })).toBe(false);
    expect(isForgeVersionJsonShape({ ...valid, inheritsFrom: "" })).toBe(false);
  });

  it("rejects non-array libraries", () => {
    expect(isForgeVersionJsonShape({ ...valid, libraries: {} })).toBe(false);
  });

  it("rejects a library missing name", () => {
    expect(isForgeVersionJsonShape({ ...valid, libraries: [{ url: "https://m/" }] })).toBe(false);
  });

  it("rejects a non-object library entry", () => {
    expect(isForgeVersionJsonShape({ ...valid, libraries: [null] })).toBe(false);
  });
});
