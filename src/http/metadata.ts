import { CACHE_TTL_MS } from "../constants/defaults";
import type { MetadataCache } from "../types/cache";
import type { HttpClient } from "../types/http";

/**
 * Inputs to {@link fetchJson}.
 *
 * @internal
 */
export type FetchJsonInput = {
  readonly url: string;
  readonly cacheKey?: string;
  readonly ttlMs?: number;
  readonly signal?: AbortSignal;
};

/**
 * GET a URL, parse the body as JSON, and cache the parsed value in {@link MetadataCache} with
 * the given TTL.
 *
 * Cache key defaults to the URL.
 *
 * @internal
 */
export const fetchJson = async <T>(
  http: HttpClient,
  cache: MetadataCache,
  input: FetchJsonInput,
): Promise<T> => {
  const key = input.cacheKey ?? `json:${input.url}`;
  const cached = cache.get<T>(key);
  if (cached !== undefined) {
    return cached;
  }
  const requestOptions: { signal?: AbortSignal } = {};
  if (input.signal !== undefined) requestOptions.signal = input.signal;
  const response = await http.request(input.url, requestOptions);
  const value = await response.json<T>();
  cache.set(key, value, input.ttlMs ?? CACHE_TTL_MS);
  return value;
};

/**
 * GET a URL and return raw text, with caching.
 *
 * @internal
 */
export const fetchText = async (
  http: HttpClient,
  cache: MetadataCache,
  input: FetchJsonInput,
): Promise<string> => {
  const key = input.cacheKey ?? `text:${input.url}`;
  const cached = cache.get<string>(key);
  if (cached !== undefined) {
    return cached;
  }
  const requestOptions: { signal?: AbortSignal } = {};
  if (input.signal !== undefined) requestOptions.signal = input.signal;
  const response = await http.request(input.url, requestOptions);
  const text = await response.text();
  cache.set(key, text, input.ttlMs ?? CACHE_TTL_MS);
  return text;
};
