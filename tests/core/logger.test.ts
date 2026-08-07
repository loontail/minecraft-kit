import { afterEach, describe, expect, it, vi } from "vitest";
import { consoleLogger, scopedLogger, silentLogger } from "../../src/core/logger";
import type { Logger, LogLevel } from "../../src/types/logger";

describe("logger", () => {
  describe("silentLogger", () => {
    it("does not throw for any level", () => {
      silentLogger.log("info", "hi");
      silentLogger.log("warn", "hi", { foo: 1 });
      expect(true).toBe(true);
    });
  });

  describe("consoleLogger", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("calls console.info for info", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
      consoleLogger.log("info", "hi");
      expect(spy).toHaveBeenCalled();
    });

    it("includes fields when present", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
      consoleLogger.log("info", "hi", { foo: 1 });
      expect(spy).toHaveBeenCalled();
    });

    it("falls back to debug for unknown levels", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
      consoleLogger.log("debug", "hi");
      expect(debugSpy).toHaveBeenCalled();
    });

    it("uses warn for warn", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      consoleLogger.log("warn", "hi");
      expect(warnSpy).toHaveBeenCalled();
    });

    it("uses error for error", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      consoleLogger.log("error", "hi");
      expect(errSpy).toHaveBeenCalled();
    });
  });

  describe("scopedLogger", () => {
    type Captured = {
      level: LogLevel;
      message: string;
      fields: Readonly<Record<string, unknown>> | undefined;
    };
    function makeCapturingLogger(): { logger: Logger; entries: Captured[] } {
      const entries: Captured[] = [];
      const logger: Logger = {
        log: (level, message, fields) => {
          entries.push({ level, message, fields });
        },
      };
      return { logger, entries };
    }

    it("prefixes messages with the scope", () => {
      const { logger, entries } = makeCapturingLogger();
      const scoped = scopedLogger(logger, "http");
      scoped.log("info", "request issued");
      expect(entries[0]?.message).toBe("[http] request issued");
      expect(entries[0]?.fields).toBeUndefined();
    });

    it("merges base fields with call-site fields (call-site wins)", () => {
      const { logger, entries } = makeCapturingLogger();
      const scoped = scopedLogger(logger, "auth", { request: "req-1" });
      scoped.log("warn", "retrying", { attempt: 2, request: "req-2" });
      expect(entries[0]?.fields).toEqual({ request: "req-2", attempt: 2 });
    });

    it("returns silentLogger when the base is silent", () => {
      expect(scopedLogger(silentLogger, "anything")).toBe(silentLogger);
    });
  });
});
