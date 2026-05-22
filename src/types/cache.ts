/**
 * Pluggable in-memory cache for HTTP metadata responses. Default implementation:
 * {@link createMemoryCache}. Implement this to back the cache by Redis, disk, etc.
 *
 * @example
 * ```ts
 * import { MinecraftKit, type MetadataCache } from "@loontail/minecraft-kit";
 *
 * const cache: MetadataCache = {
 *   get: <T>(key: string) => store.get(key) as T | undefined,
 *   set: <T>(key: string, value: T) => store.set(key, value),
 *   delete: (key) => store.delete(key),
 *   clear: () => store.clear(),
 * };
 * const kit = new MinecraftKit({ cache });
 * ```
 */
export type MetadataCache = {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs?: number): void;
  delete(key: string): void;
  clear(): void;
};
