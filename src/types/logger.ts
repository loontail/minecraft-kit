/**
 * Log levels accepted by the pluggable logger.
 *
 * @example
 * ```ts
 * import { LogLevels, type Logger } from "@loontail/minecraft-kit";
 *
 * const logger: Logger = {
 *   log: (level, message) => {
 *     if (level === LogLevels.ERROR) console.error(message);
 *     else console.log(level, message);
 *   },
 * };
 * ```
 */
export const LogLevels = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
} as const;

/**
 * Log-level literal.
 *
 * @example
 * ```ts
 * import { LogLevels, type LogLevel } from "@loontail/minecraft-kit";
 *
 * const enabled = new Set<LogLevel>([LogLevels.INFO, LogLevels.WARN, LogLevels.ERROR]);
 * ```
 */
export type LogLevel = (typeof LogLevels)[keyof typeof LogLevels];

/**
 * Pluggable logger. Default implementation is a silent logger; pass your own to surface logs.
 *
 * @example
 * ```ts
 * import { MinecraftKit, type Logger } from "@loontail/minecraft-kit";
 *
 * const logger: Logger = {
 *   log: (level, message, fields) => myLogger.write({ level, message, ...fields }),
 * };
 * const kit = new MinecraftKit({ logger });
 * ```
 */
export type Logger = {
  log(level: LogLevel, message: string, fields?: Readonly<Record<string, unknown>>): void;
};
