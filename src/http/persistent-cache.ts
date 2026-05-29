import { createHash } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { PERSISTENT_CACHE_TTL_MS } from "../constants/defaults";
import { atomicWrite } from "../core/fs";
import { isPlainObject } from "../core/guards";
import { parseJsonOrUndefined } from "../core/json";
import type { MetadataCache } from "../types/cache";

/**
 * Options for {@link createPersistentMetadataCache}.
 *
 * @example
 * ```ts
 * import { createPersistentMetadataCache, MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const cache = await createPersistentMetadataCache({
 *   directory: path.join(app.getPath("userData"), "kit-metadata-cache"),
 *   onWriteError: (error) => log.warn("metadata cache write failed", error),
 * });
 * const kit = new MinecraftKit({ cache });
 * ```
 */
export type PersistentMetadataCacheOptions = {
  /** Directory the cache owns; created on first write. One JSON file per entry. */
  readonly directory: string;
  /** Retention per entry, in milliseconds. Defaults to {@link PERSISTENT_CACHE_TTL_MS}. */
  readonly ttlMs?: number;
  /**
   * Called when a background disk write/delete fails. The in-memory layer stays correct
   * regardless, so a failed persist only costs the next process a cache miss — surface it as
   * a warning rather than letting it reject anything.
   */
  readonly onWriteError?: (error: unknown) => void;
};

/**
 * Disk-backed {@link MetadataCache} plus a {@link PersistentMetadataCache.flush} hook for
 * awaiting in-flight writes (e.g. on app quit, or in tests).
 *
 * @example
 * ```ts
 * const cache = await createPersistentMetadataCache({ directory });
 * cache.set("k", { hello: "world" });
 * await cache.flush();
 * ```
 */
export type PersistentMetadataCache = MetadataCache & {
  /** Resolve once every queued disk write/delete has settled. */
  flush(): Promise<void>;
};

type CacheEntry = {
  readonly value: unknown;
  readonly expiresAt: number;
};

type PersistedEntry = {
  readonly key: string;
  readonly value: unknown;
  readonly expiresAt: number;
};

/**
 * Create a {@link MetadataCache} that survives process restarts. Resolved version manifests,
 * asset indexes, and runtime indexes written during one launch are still readable on the
 * next — so a target resolved while online resolves offline later without the per-endpoint
 * 30s network stall. This is the kit side of the launcher's fully-offline status seed
 * (launcher `optimization-13`).
 *
 * The cache is in-memory for reads (so the synchronous {@link MetadataCache.get} contract is
 * honoured) and write-through to disk. The factory is async because it hydrates the in-memory
 * layer from disk, dropping (and cleaning up) entries that have passed their `ttlMs`.
 *
 * Per-entry retention is the cache's own `ttlMs`, not the short per-call TTL the metadata
 * layer passes — that short TTL guards a single process against serving stale data, whereas
 * persistence exists precisely to outlive it.
 *
 * @example
 * ```ts
 * import { createPersistentMetadataCache, MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const cache = await createPersistentMetadataCache({ directory });
 * const kit = new MinecraftKit({ cache });
 * const target = await kit.targets.resolve(input); // hits disk cache when offline
 * ```
 */
export const createPersistentMetadataCache = async (
  options: PersistentMetadataCacheOptions,
): Promise<PersistentMetadataCache> => {
  const ttlMs = options.ttlMs ?? PERSISTENT_CACHE_TTL_MS;
  const directory = options.directory;
  const memory = new Map<string, CacheEntry>();
  const pending = new Set<Promise<void>>();
  const writeQueues = new Map<string, Promise<void>>();

  const fileFor = (key: string): string =>
    path.join(directory, `${createHash("sha1").update(key, "utf8").digest("hex")}.json`);

  const track = (op: Promise<void>): void => {
    const wrapped = op
      .catch((error) => {
        options.onWriteError?.(error);
      })
      .finally(() => {
        pending.delete(wrapped);
      });
    pending.add(wrapped);
  };

  /**
   * Serialize disk ops per key so a `set` immediately followed by a `delete` (or a
   * get-expiry cleanup) cannot reorder — without this the `rm` can land before the
   * `atomicWrite` and leave the entry on disk to be rehydrated next launch.
   */
  const enqueue = (key: string, op: () => Promise<void>): void => {
    const previous = writeQueues.get(key) ?? Promise.resolve();
    const settled = previous.then(op, op).finally(() => {
      if (writeQueues.get(key) === settled) writeQueues.delete(key);
    });
    writeQueues.set(key, settled);
    track(settled);
  };

  await hydrate(directory, memory, track);

  return {
    get<T>(key: string): T | undefined {
      const entry = memory.get(key);
      if (entry === undefined) return undefined;
      if (entry.expiresAt <= Date.now()) {
        memory.delete(key);
        enqueue(key, () => removeFile(fileFor(key)));
        return undefined;
      }
      return entry.value as T;
    },
    set<T>(key: string, value: T): void {
      const expiresAt = Date.now() + ttlMs;
      memory.set(key, { value, expiresAt });
      const persisted: PersistedEntry = { key, value, expiresAt };
      enqueue(key, () => atomicWrite(fileFor(key), JSON.stringify(persisted)));
    },
    delete(key: string): void {
      memory.delete(key);
      enqueue(key, () => removeFile(fileFor(key)));
    },
    clear(): void {
      memory.clear();
      writeQueues.clear();
      track(rm(directory, { recursive: true, force: true }));
    },
    async flush(): Promise<void> {
      await Promise.all([...pending]);
    },
  };
};

const hydrate = async (
  directory: string,
  memory: Map<string, CacheEntry>,
  track: (op: Promise<void>) => void,
): Promise<void> => {
  let files: readonly string[];
  try {
    files = await readdir(directory);
  } catch {
    /* directory absent on first run — nothing to hydrate */
    return;
  }
  const now = Date.now();
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(directory, file);
    const entry = await readEntryFile(filePath);
    if (entry === undefined) continue;
    if (entry.expiresAt <= now) {
      track(removeFile(filePath));
      continue;
    }
    memory.set(entry.key, { value: entry.value, expiresAt: entry.expiresAt });
  }
};

const readEntryFile = async (filePath: string): Promise<PersistedEntry | undefined> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    /* unreadable entry — treat as absent so a stray FS error never breaks a resolve */
    return undefined;
  }
  const parsed = parseJsonOrUndefined<unknown>(raw);
  return isPersistedEntry(parsed) ? parsed : undefined;
};

const isPersistedEntry = (value: unknown): value is PersistedEntry =>
  isPlainObject(value) &&
  typeof value.key === "string" &&
  typeof value.expiresAt === "number" &&
  "value" in value;

const removeFile = (filePath: string): Promise<void> => rm(filePath, { force: true });
