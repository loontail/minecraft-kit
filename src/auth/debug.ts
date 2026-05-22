import process from "node:process";
import { consoleLogger, scopedLogger, silentLogger } from "../core/logger";
import type { Logger } from "../types/logger";

/**
 * When set to a truthy value, the kit ships a stderr-bound `Logger` to the auth modules
 * even if the caller didn't supply one. Useful for one-off CLI debugging without wiring a
 * logger all the way through `MinecraftKit`.
 *
 * @internal
 */
export const DEBUG_ENV_VAR = "MINECRAFT_KIT_AUTH_DEBUG";

/**
 * Build the `auth` scope's logger. Caller-supplied logger wins; otherwise we honour
 * `MINECRAFT_KIT_AUTH_DEBUG=1` by routing through `consoleLogger`. Default is silent so
 * the auth flow stays quiet in production.
 *
 * @internal
 */
export const buildAuthLogger = (base: Logger | undefined): Logger => {
  if (base !== undefined) return scopedLogger(base, "auth");
  if (process.env[DEBUG_ENV_VAR]) return scopedLogger(consoleLogger, "auth");
  return silentLogger;
};
