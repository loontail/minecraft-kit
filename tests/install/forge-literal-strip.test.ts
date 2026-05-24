import { describe, expect, it } from "vitest";
import { decodeForgeDataValue, stripLiteralPrefix } from "../../src/install/forge-install";

describe("stripLiteralPrefix", () => {
  it("strips both leading and trailing single quotes", () => {
    expect(stripLiteralPrefix("'bbe5ec9c5b3968997952df1b547f5b4db47b6dec'")).toBe(
      "bbe5ec9c5b3968997952df1b547f5b4db47b6dec",
    );
  });

  it("strips a leading quote when no trailing quote is present", () => {
    expect(stripLiteralPrefix("'abc")).toBe("abc");
  });

  it("strips a trailing quote when no leading quote is present", () => {
    expect(stripLiteralPrefix("abc'")).toBe("abc");
  });

  it("passes through values with no wrapping quotes", () => {
    expect(stripLiteralPrefix("plain-value")).toBe("plain-value");
  });

  it("returns empty string when input is a pair of empty quotes", () => {
    expect(stripLiteralPrefix("''")).toBe("");
  });
});

describe("decodeForgeDataValue", () => {
  it("classifies a `[maven:coord]` value and exposes the inner coord", () => {
    expect(
      decodeForgeDataValue("[de.oceanlabs.mcp:mcp_config:1.18.2-20220404.173914:mappings@txt]"),
    ).toEqual({
      kind: "maven",
      coord: "de.oceanlabs.mcp:mcp_config:1.18.2-20220404.173914:mappings@txt",
    });
  });

  it("classifies a `'literal'` value and strips BOTH single quotes", () => {
    // Regression: the previous implementation stripped only the leading quote,
    // leaking a trailing `'` into args that referenced the token via `{KEY}`.
    // Forge `Util.replaceTokens` treats `'…'` as a literal and drops both
    // wrapping quotes.
    expect(decodeForgeDataValue("'cdb4d4f8c358d1316025084791669dfc9676ba9a'")).toEqual({
      kind: "literal",
      value: "cdb4d4f8c358d1316025084791669dfc9676ba9a",
    });
  });

  it("classifies a `'literal'` value with no trailing quote (still strips the leading one)", () => {
    expect(decodeForgeDataValue("'unterminated")).toEqual({
      kind: "literal",
      value: "unterminated",
    });
  });

  it("classifies a `/path/inside/installer` value as an extract directive", () => {
    expect(decodeForgeDataValue("/data/client.lzma")).toEqual({
      kind: "extract",
      entryName: "data/client.lzma",
    });
  });

  it("passes a bare value through unchanged", () => {
    expect(decodeForgeDataValue("20220404.173914")).toEqual({
      kind: "raw",
      value: "20220404.173914",
    });
  });

  it("does not treat a mismatched bracket pair as a Maven coord", () => {
    // The `[` prefix alone is not enough — `endsWith(']')` must also hold.
    expect(decodeForgeDataValue("[not-a-coord")).toEqual({
      kind: "raw",
      value: "[not-a-coord",
    });
  });
});
