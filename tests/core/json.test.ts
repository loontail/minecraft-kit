import { describe, expect, it } from "vitest";
import { isErrorCode, MinecraftKitError } from "../../src/core/errors";
import { parseJsonAs, parseJsonOrUndefined, parseJsonStrict } from "../../src/core/json";

describe("parseJsonStrict", () => {
  it("returns parsed value on success", () => {
    const value = parseJsonStrict<{ a: number }>('{"a":1}', {
      code: "MANIFEST_INVALID",
      message: "should not throw",
    });
    expect(value).toEqual({ a: 1 });
  });

  it("throws without context when none was supplied", () => {
    try {
      parseJsonStrict("{nope", { code: "MANIFEST_INVALID", message: "bad" });
      expect.fail("expected throw");
    } catch (error) {
      const err = error as MinecraftKitError;
      expect(err.code).toBe("MANIFEST_INVALID");
      expect(err.context).toEqual({});
    }
  });

  it("throws a coded MinecraftKitError carrying cause + context on failure", () => {
    try {
      parseJsonStrict("{not json", {
        code: "MANIFEST_INVALID",
        message: "bad version json",
        context: { filePath: "/x.json" },
      });
      expect.fail("expected throw");
    } catch (error) {
      expect(isErrorCode(error, "MANIFEST_INVALID")).toBe(true);
      const err = error as MinecraftKitError;
      expect(err.message).toBe("bad version json");
      expect(err.context.filePath).toBe("/x.json");
      expect(err.cause).toBeInstanceOf(SyntaxError);
    }
  });
});

describe("parseJsonAs", () => {
  it("accepts values that pass the guard", () => {
    const value = parseJsonAs<{ a: number }>(
      '{"a":2}',
      (v): v is { a: number } =>
        typeof v === "object" && v !== null && typeof (v as Record<string, unknown>).a === "number",
      { code: "MANIFEST_INVALID", message: "shape mismatch" },
    );
    expect(value.a).toBe(2);
  });

  it("throws if parsed value fails the guard", () => {
    expect(() =>
      parseJsonAs<{ a: number }>(
        '{"b":2}',
        (v): v is { a: number } =>
          typeof v === "object" &&
          v !== null &&
          typeof (v as Record<string, unknown>).a === "number",
        { code: "MANIFEST_INVALID", message: "shape mismatch" },
      ),
    ).toThrow(MinecraftKitError);
  });

  it("forwards context when supplied", () => {
    try {
      parseJsonAs<{ a: number }>(
        "{}",
        (v): v is { a: number } =>
          typeof v === "object" &&
          v !== null &&
          typeof (v as Record<string, unknown>).a === "number",
        {
          code: "MANIFEST_INVALID",
          message: "shape mismatch",
          context: { filePath: "/x.json" },
        },
      );
      expect.fail("expected throw");
    } catch (error) {
      expect((error as MinecraftKitError).context.filePath).toBe("/x.json");
    }
  });
});

describe("parseJsonOrUndefined", () => {
  it("returns parsed value on success", () => {
    expect(parseJsonOrUndefined<{ x: number }>('{"x":1}')).toEqual({ x: 1 });
  });
  it("returns undefined on failure", () => {
    expect(parseJsonOrUndefined("nope")).toBeUndefined();
  });
});
