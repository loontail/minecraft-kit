/**
 * Pluggable in-memory cache for HTTP metadata responses. Default implementation:
 * {@link createMemoryCache}. Implement this to back the cache by Redis, disk, etc.
 */
export type MetadataCache = {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs?: number): void;
  delete(key: string): void;
  clear(): void;
};
