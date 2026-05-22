import { describe, expect, it } from "vitest";
import { formatUserError } from "../../src/cli/error-format";
import { MinecraftKitError } from "../../src/core/errors";
import type { MinecraftKitErrorCode } from "../../src/types/errors";

const SAMPLE_MESSAGE = "sample-error-message";

const CASES: Record<MinecraftKitErrorCode, RegExp> = {
  NETWORK_TIMEOUT: /timed out/,
  NETWORK_HTTP_ERROR: new RegExp(SAMPLE_MESSAGE),
  NETWORK_ABORTED: /aborted/i,
  INTEGRITY_HASH_MISMATCH: /hash check/,
  INTEGRITY_SIZE_MISMATCH: /wrong size/,
  MANIFEST_INVALID: /malformed/,
  MANIFEST_NOT_FOUND: /not available/,
  METADATA_PARSE_ERROR: new RegExp(SAMPLE_MESSAGE),
  FILESYSTEM_PATH_TRAVERSAL: /escape/,
  FILESYSTEM_WRITE_ERROR: new RegExp(`Filesystem error: ${SAMPLE_MESSAGE}`),
  FILESYSTEM_READ_ERROR: new RegExp(`Filesystem error: ${SAMPLE_MESSAGE}`),
  ARCHIVE_INVALID: new RegExp(SAMPLE_MESSAGE),
  ARCHIVE_TOO_LARGE: new RegExp(SAMPLE_MESSAGE),
  ARCHIVE_ENTRY_REJECTED: new RegExp(SAMPLE_MESSAGE),
  RUNTIME_NOT_FOUND: /runtime is published/,
  RUNTIME_UNSUPPORTED_PLATFORM: /platform/,
  FORGE_PROCESSOR_FAILED: /Forge processor/,
  FORGE_INSTALLER_INVALID: /Forge installer/,
  LAUNCH_JAVA_NOT_FOUND: /Java executable/,
  LAUNCH_PROCESS_FAILED: /Minecraft exited/,
  LAUNCH_ABORTED: /aborted/i,
  VERIFICATION_FAILED: new RegExp(SAMPLE_MESSAGE),
  INVALID_INPUT: new RegExp(SAMPLE_MESSAGE),
  NOT_IMPLEMENTED: new RegExp(SAMPLE_MESSAGE),
  UNSUPPORTED_VERSION: new RegExp(SAMPLE_MESSAGE),
  AUTH_AUTHORIZATION_CODE_DECLINED: new RegExp(SAMPLE_MESSAGE),
  AUTH_AUTHORIZATION_CODE_FAILED: new RegExp(SAMPLE_MESSAGE),
  AUTH_REFRESH_FAILED: new RegExp(SAMPLE_MESSAGE),
  AUTH_XBOX_FAILED: new RegExp(SAMPLE_MESSAGE),
  AUTH_XSTS_FAILED: new RegExp(SAMPLE_MESSAGE),
  AUTH_MINECRAFT_FAILED: new RegExp(SAMPLE_MESSAGE),
  AUTH_NO_GAME_OWNERSHIP: new RegExp(SAMPLE_MESSAGE),
  AUTH_MISSING_CLIENT_ID: new RegExp(SAMPLE_MESSAGE),
  AUTH_CANCELLED: new RegExp(SAMPLE_MESSAGE),
};

describe("formatUserError", () => {
  it.each(Object.entries(CASES) as [MinecraftKitErrorCode, RegExp][])(
    "translates %s with the expected pattern",
    (code, pattern) => {
      expect(formatUserError(new MinecraftKitError(code, SAMPLE_MESSAGE))).toMatch(pattern);
    },
  );

  it("translates HTTP 400 to a friendly message", () => {
    const e = new MinecraftKitError("NETWORK_HTTP_ERROR", "HTTP 400", {
      context: { httpStatus: 400 },
    });
    expect(formatUserError(e)).toContain("No matching data");
  });

  it("translates HTTP 404 to the same friendly message", () => {
    const e = new MinecraftKitError("NETWORK_HTTP_ERROR", "HTTP 404", {
      context: { httpStatus: 404 },
    });
    expect(formatUserError(e)).toContain("No matching data");
  });

  it("translates 408 / 429 / 5xx to dedicated messages", () => {
    expect(
      formatUserError(
        new MinecraftKitError("NETWORK_HTTP_ERROR", "x", { context: { httpStatus: 408 } }),
      ),
    ).toMatch(/took too long/);
    expect(
      formatUserError(
        new MinecraftKitError("NETWORK_HTTP_ERROR", "x", { context: { httpStatus: 429 } }),
      ),
    ).toMatch(/rate-limiting/);
    expect(
      formatUserError(
        new MinecraftKitError("NETWORK_HTTP_ERROR", "x", { context: { httpStatus: 503 } }),
      ),
    ).toMatch(/server returned an error/);
  });

  it("falls back to a generic HTTP message for other statuses", () => {
    const message = formatUserError(
      new MinecraftKitError("NETWORK_HTTP_ERROR", "x", { context: { httpStatus: 418 } }),
    );
    expect(message).toContain("418");
  });

  it("returns the original message for non-kit errors", () => {
    expect(formatUserError(new Error("plain"))).toBe("plain");
    expect(formatUserError("string")).toBe("string");
  });
});
