import { LRUCache } from "lru-cache";
import { CACHE_MAX_ENTRIES, CACHE_TTL_MS } from "../constants/defaults";
import type { MetadataCache } from "../types/cache";

/**
 * Inputs to {@link createMemoryCache}.
 *
 * @example
 * ```ts
 * import { createMemoryCache, type MemoryCacheOptions } from "@loontail/minecraft-kit";
 *
 * const options: MemoryCacheOptions = { maxEntries: 256, ttlMs: 5 * 60 * 1000 };
 * const cache = createMemoryCache(options);
 * ```
 */
export type MemoryCacheOptions = {
  readonly maxEntries?: number;
  readonly ttlMs?: number;
};

/**
 * In-memory metadata cache backed by `lru-cache`. Suitable for short-lived processes;
 * pass a custom {@link MetadataCache} to share entries across runs (Redis, disk, etc.).
 *
 * @example
 * ```ts
 * import { createMemoryCache, MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const cache = createMemoryCache({ maxEntries: 128 });
 * const kit = new MinecraftKit({ cache });
 * // Version manifests and asset indexes are cached across kit operations.
 * ```
 */
export const createMemoryCache = (options: MemoryCacheOptions = {}): MetadataCache => {
  const cache = new LRUCache<string, object>({
    max: options.maxEntries ?? CACHE_MAX_ENTRIES,
    ttl: options.ttlMs ?? CACHE_TTL_MS,
  });
  return {
    get<T>(key: string): T | undefined {
      const wrapped = cache.get(key) as { value: T } | undefined;
      return wrapped === undefined ? undefined : wrapped.value;
    },
    set<T>(key: string, value: T, ttlMs?: number): void {
      const wrapped = { value };
      if (ttlMs === undefined) {
        cache.set(key, wrapped);
      } else {
        cache.set(key, wrapped, { ttl: ttlMs });
      }
    },
    delete(key: string): void {
      cache.delete(key);
    },
    clear(): void {
      cache.clear();
    },
  };
};
