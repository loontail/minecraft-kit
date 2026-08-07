import { describe, expect, it, vi } from "vitest";
import { filterArgsForJava } from "../../src/launch/jvm-compat";
import type { Logger } from "../../src/types/logger";
import { parseMajorVersion } from "../../src/versions/runtime";

describe("parseMajorVersion", () => {
  it("extracts the leading int from a Mojang versionName", () => {
    expect(parseMajorVersion("21.0.8")).toBe(21);
    expect(parseMajorVersion("17.0.15")).toBe(17);
    expect(parseMajorVersion("8.0.362-b08")).toBe(8);
  });

  it("returns undefined for non-numeric prefixes", () => {
    expect(parseMajorVersion("invalid")).toBeUndefined();
    expect(parseMajorVersion("")).toBeUndefined();
  });
});

describe("filterArgsForJava", () => {
  it("drops --sun-misc-unsafe-memory-access on Java 17", () => {
    const log = vi.fn<Logger["log"]>();
    const result = filterArgsForJava({
      args: ["-Xmx4G", "--sun-misc-unsafe-memory-access=allow", "-Xms1G"],
      javaMajor: 17,
      logger: { log },
    });
    expect(result).toEqual(["-Xmx4G", "-Xms1G"]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("warn", expect.stringMatching(/Java 23/), {
      flag: "--sun-misc-unsafe-memory-access=allow",
      minJava: 23,
      runtimeJava: 17,
    });
  });

  it("keeps --sun-misc-unsafe-memory-access on Java 24", () => {
    const result = filterArgsForJava({
      args: ["--sun-misc-unsafe-memory-access=allow"],
      javaMajor: 24,
    });
    expect(result).toEqual(["--sun-misc-unsafe-memory-access=allow"]);
  });

  it("drops -XX:+UseCompactObjectHeaders on Java 21", () => {
    const result = filterArgsForJava({
      args: ["-XX:+UseCompactObjectHeaders", "-XX:+UseG1GC"],
      javaMajor: 21,
    });
    expect(result).toEqual(["-XX:+UseG1GC"]);
  });

  it("passes through unknown flags unchanged", () => {
    const result = filterArgsForJava({
      args: ["-Dfoo=bar", "--enable-something-novel"],
      javaMajor: 8,
    });
    expect(result).toEqual(["-Dfoo=bar", "--enable-something-novel"]);
  });

  it("is a no-op when javaMajor is non-finite or zero", () => {
    const args = ["--sun-misc-unsafe-memory-access=allow"];
    expect(filterArgsForJava({ args, javaMajor: 0 })).toEqual(args);
    expect(filterArgsForJava({ args, javaMajor: Number.NaN })).toEqual(args);
  });
});
