/**
 * Log levels accepted by the pluggable logger.
 */
export const LogLevels = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
} as const;

/**
 * Log-level literal.
 */
export type LogLevel = (typeof LogLevels)[keyof typeof LogLevels];

/**
 * Pluggable logger. Default implementation is a silent logger; pass your own to surface logs.
 */
export type Logger = {
  log(level: LogLevel, message: string, fields?: Readonly<Record<string, unknown>>): void;
};
