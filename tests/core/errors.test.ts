import { describe, expect, it } from "vitest";
import { isErrorCode, isMinecraftKitError, MinecraftKitError } from "../../src/core/errors";

describe("MinecraftKitError", () => {
  it("captures code and context", () => {
    const error = new MinecraftKitError("INVALID_INPUT", "bad", {
      context: { url: "https://example.com" },
    });
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.context).toEqual({ url: "https://example.com" });
    expect(error.context).not.toBe(undefined);
  });

  it("freezes context", () => {
    const error = new MinecraftKitError("INVALID_INPUT", "bad", {
      context: { url: "x" },
    });
    expect(Object.isFrozen(error.context)).toBe(true);
  });

  it("supports cause", () => {
    const cause = new Error("root");
    const error = new MinecraftKitError("NETWORK_HTTP_ERROR", "outer", { cause });
    expect(error.cause).toBe(cause);
  });

  it("constructs without context", () => {
    const error = new MinecraftKitError("NOT_IMPLEMENTED", "no");
    expect(error.context).toEqual({});
  });

  it("serializes via toJSON", () => {
    const cause = new Error("inner");
    const error = new MinecraftKitError("MANIFEST_INVALID", "outer", {
      cause,
      context: { filePath: "/x" },
    });
    const json = error.toJSON();
    expect(json.code).toBe("MANIFEST_INVALID");
    expect(json.message).toBe("outer");
    expect(json.context).toEqual({ filePath: "/x" });
    const causeOut = (json.cause as { message?: string })?.message;
    expect(causeOut).toBe("inner");
  });

  it("toJSON passes through non-Error causes", () => {
    const error = new MinecraftKitError("INVALID_INPUT", "outer", { cause: "just a string" });
    expect(error.toJSON().cause).toBe("just a string");
  });

  it("isMinecraftKitError narrows type", () => {
    const err = new MinecraftKitError("INVALID_INPUT", "x");
    expect(isMinecraftKitError(err)).toBe(true);
    expect(isMinecraftKitError(new Error("nope"))).toBe(false);
    expect(isMinecraftKitError("string")).toBe(false);
  });

  it("isErrorCode narrows by code", () => {
    const err = new MinecraftKitError("INVALID_INPUT", "x");
    expect(isErrorCode(err, "INVALID_INPUT")).toBe(true);
    expect(isErrorCode(err, "NETWORK_TIMEOUT")).toBe(false);
    expect(isErrorCode("string", "INVALID_INPUT")).toBe(false);
  });
});
