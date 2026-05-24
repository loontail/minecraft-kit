import { describe, expect, it } from "vitest";
import {
  isForgeInstallProfileShape,
  isForgeVersionJsonShape,
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
