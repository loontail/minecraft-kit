import {
  HTTP_RETRY_BACKOFF_BASE_MS,
  HTTP_RETRY_BACKOFF_CAP_MS,
  HTTP_RETRY_MAX,
} from "../constants/defaults";
import { MinecraftKitError, MinecraftKitErrorCodes, isMinecraftKitError } from "./errors";

/**
 * Inputs passed to {@link withRetry}.
 *
 * @internal
 */
export type RetryOptions = {
  readonly maxAttempts?: number;
  readonly baseMs?: number;
  readonly capMs?: number;
  readonly signal?: AbortSignal;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly random?: () => number;
  readonly onAttemptFailed?: (error: unknown, attempt: number) => void;
};

/**
 * Default sleep that respects the abort signal.
 *
 * @internal
 */
export const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(toAbortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(toAbortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

const toAbortError = (signal?: AbortSignal): Error => {
  return new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_ABORTED, "Operation aborted", {
    context: { reason: signal?.reason },
  });
};

/**
 * Run `op` with full-jitter exponential backoff. Retries only when {@link isRetryable}
 * returns true.
 *
 * @internal
 */
export const withRetry = async <T>(
  op: (attempt: number) => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  options: RetryOptions = {},
): Promise<T> => {
  const max = options.maxAttempts ?? HTTP_RETRY_MAX;
  const base = options.baseMs ?? HTTP_RETRY_BACKOFF_BASE_MS;
  const cap = options.capMs ?? HTTP_RETRY_BACKOFF_CAP_MS;
  const sleep = options.sleep ?? abortableSleep;
  const random = options.random ?? Math.random;
  let lastError: unknown;
  for (let attempt = 0; attempt < max; attempt++) {
    if (options.signal?.aborted) {
      throw toAbortError(options.signal);
    }
    try {
      return await op(attempt);
    } catch (error) {
      lastError = error;
      options.onAttemptFailed?.(error, attempt);
      if (!isRetryable(error) || attempt === max - 1) {
        throw error;
      }
      const delayCap = Math.min(cap, base * 2 ** attempt);
      const delay = Math.floor(random() * delayCap);
      await sleep(delay, options.signal);
    }
  }
  // Should be unreachable; the for-loop returns or throws.
  throw lastError ?? new Error("withRetry exhausted attempts");
};

/**
 * Default retry predicate for HTTP-like errors.
 *
 * @internal
 */
export const isHttpRetryable = (error: unknown): boolean => {
  if (!isMinecraftKitError(error)) {
    return false;
  }
  if (error.code === "NETWORK_ABORTED") return false;
  if (error.code === "NETWORK_TIMEOUT") return true;
  if (error.code === "NETWORK_HTTP_ERROR") {
    const status = typeof error.context.httpStatus === "number" ? error.context.httpStatus : 0;
    if (status === 408 || status === 425 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return status === 0;
  }
  return false;
};
