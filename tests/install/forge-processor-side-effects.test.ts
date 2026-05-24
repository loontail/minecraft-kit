import { describe, expect, it } from "vitest";
import { collectSideEffectOutputs } from "../../src/install/processor";

describe("collectSideEffectOutputs", () => {
  it("returns the path following each `--output` flag", () => {
    expect(
      collectSideEffectOutputs([
        "--task",
        "MCP_DATA",
        "--input",
        "/in.zip",
        "--output",
        "/out.txt",
        "--key",
        "mappings",
      ]),
    ).toEqual(["/out.txt"]);
  });

  it("returns paths after every recognised output flag, in declaration order", () => {
    // EXTRACT_FILES emits `--from <src> --to <dst>` pairs; SpecialSource uses
    // `--out-jar`; installertools sometimes uses `--out`. All four must land
    // in the verification set so a 0-exit processor that silently skipped its
    // write is caught here instead of crashing the next processor downstream.
    expect(
      collectSideEffectOutputs([
        "--from",
        "/src/a",
        "--to",
        "/dst/a",
        "--out-jar",
        "/built.jar",
        "--out",
        "/extras.bin",
      ]),
    ).toEqual(["/dst/a", "/built.jar", "/extras.bin"]);
  });

  it("excludes paths flagged via `--optional`, regardless of declaration order", () => {
    expect(
      collectSideEffectOutputs([
        "--from",
        "/src/user_jvm_args.txt",
        "--to",
        "/dst/user_jvm_args.txt",
        "--optional",
        "/dst/user_jvm_args.txt",
      ]),
    ).toEqual([]);
  });

  it("ignores a trailing flag with no value", () => {
    // Defensive: if Forge ever emits a malformed args array, we should not
    // index past the end. The trailing `--output` with no following path is
    // dropped rather than crashing the install.
    expect(collectSideEffectOutputs(["--output", "/written", "--out"])).toEqual(["/written"]);
  });

  it("does not match a partial flag like `--outputs`", () => {
    expect(collectSideEffectOutputs(["--outputs", "/not-an-output"])).toEqual([]);
  });
});
