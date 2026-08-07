import type { MinecraftKitErrorCode, MinecraftKitErrorContext } from "../types/errors";
import { MinecraftKitError } from "./errors";

/**
 * `JSON.parse(text)` typed as `T`, wrapped so a parse failure becomes a
 * {@link MinecraftKitError} with the caller's `code`/`message`/`context`.
 *
 * Note: this is a parse-only helper — it does not validate the resulting shape. Pair with a
 * runtime check (or use {@link parseJsonAs} which accepts a guard) when the payload comes
 * from an untrusted source.
 *
 * @internal
 */
export const parseJsonStrict = <T>(
  text: string,
  options: {
    readonly code: MinecraftKitErrorCode;
    readonly message: string;
    readonly context?: MinecraftKitErrorContext;
  },
): T => {
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new MinecraftKitError(options.code, options.message, {
      cause,
      ...(options.context !== undefined ? { context: options.context } : {}),
    });
  }
};

/**
 * Like {@link parseJsonStrict} but also runs `guard` against the parsed value. The runtime
 * validation step is the difference between "the JSON parsed" and "the JSON matches what we
 * expect" — important on responses pulled over the network.
 *
 * @internal
 */
export const parseJsonAs = <T>(
  text: string,
  guard: (value: unknown) => value is T,
  options: {
    readonly code: MinecraftKitErrorCode;
    readonly message: string;
    readonly context?: MinecraftKitErrorContext;
  },
): T => {
  const value = parseJsonStrict<unknown>(text, options);
  if (!guard(value)) {
    throw new MinecraftKitError(options.code, options.message, {
      ...(options.context !== undefined ? { context: options.context } : {}),
    });
  }
  return value;
};

/**
 * Parse JSON or return `undefined` on failure. Use when "couldn't parse" and "doesn't apply
 * here" should produce the same outcome (e.g. peeking at unverified files on disk).
 *
 * @internal
 */
export const parseJsonOrUndefined = <T>(text: string): T | undefined => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
};
