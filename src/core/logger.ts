import { LogLevels } from "../types/logger";
import type { LogLevel, Logger } from "../types/logger";

/**
 * Logger that drops every message. Default when no logger is supplied.
 *
 * @example
 * ```ts
 * import { MinecraftKit, silentLogger } from "@loontail/minecraft-kit";
 *
 * // Explicit "no logging" — equivalent to omitting `logger` entirely.
 * const kit = new MinecraftKit({ logger: silentLogger });
 * ```
 */
export const silentLogger: Logger = {
  log() {
    // Intentionally empty.
  },
};

/**
 * Logger that mirrors messages to `console.<level>` with structured fields.
 *
 * @example
 * ```ts
 * import { consoleLogger, MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit({ logger: consoleLogger });
 * // Each kit operation now writes "[info] ...", "[warn] ...", etc. via console.
 * ```
 */
export const consoleLogger: Logger = {
  log(level, message, fields) {
    const target = pickConsole(level);
    if (fields !== undefined) {
      target(`[${level}] ${message}`, fields);
    } else {
      target(`[${level}] ${message}`);
    }
  },
};

/**
 * Wrap a {@link Logger} so every message is prefixed with `[scope]`. Mirrors the
 * `scopedLogger(scope)` convention used by the launcher: each module reaches for one named
 * logger at the top of the file (e.g. `const log = scopedLogger(input.logger, "http")`)
 * instead of threading the scope through every callsite.
 *
 * The merged `fields` argument lets a scope attach default context (e.g. a request id) without
 * the call site repeating it on every message.
 *
 * @example
 * ```ts
 * import { consoleLogger, scopedLogger } from "@loontail/minecraft-kit";
 *
 * const log = scopedLogger(consoleLogger, "fabric-installer", { profileId: "fabric-loader-0.15.7" });
 * log.log("info", "patching profile");
 * // → [info] [fabric-installer] patching profile { profileId: "fabric-loader-0.15.7" }
 * ```
 */
export const scopedLogger = (
  base: Logger,
  scope: string,
  baseFields?: Readonly<Record<string, unknown>>,
): Logger => {
  if (base === silentLogger) return silentLogger;
  return {
    log(level, message, fields) {
      const merged =
        baseFields !== undefined || fields !== undefined ? { ...baseFields, ...fields } : undefined;
      if (merged !== undefined) {
        base.log(level, `[${scope}] ${message}`, merged);
      } else {
        base.log(level, `[${scope}] ${message}`);
      }
    },
  };
};

const pickConsole = (level: LogLevel): ((...args: unknown[]) => void) => {
  if (level === LogLevels.ERROR) return console.error.bind(console);
  if (level === LogLevels.WARN) return console.warn.bind(console);
  if (level === LogLevels.INFO) return console.info.bind(console);
  return console.debug.bind(console);
};
