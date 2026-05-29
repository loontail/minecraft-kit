/**
 * HTTP request timeout for metadata calls, in milliseconds.
 *
 * @internal
 */
export const HTTP_TIMEOUT_MS = 30_000;

/**
 * Maximum retry attempts for transient HTTP failures.
 *
 * @internal
 */
export const HTTP_RETRY_MAX = 4;

/**
 * Base delay for exponential backoff, in milliseconds.
 *
 * @internal
 */
export const HTTP_RETRY_BACKOFF_BASE_MS = 500;

/**
 * Maximum delay for exponential backoff, in milliseconds.
 *
 * @internal
 */
export const HTTP_RETRY_BACKOFF_CAP_MS = 30_000;

/**
 * Default per-host concurrency for downloads. The runner uses a worker-pool: when one file
 * finishes, the next file in the queue starts immediately. There is no batch barrier.
 *
 * @internal
 */
export const DOWNLOAD_CONCURRENCY = 32;

/**
 * TTL for in-memory metadata cache entries, in milliseconds.
 *
 * @internal
 */
export const CACHE_TTL_MS = 5 * 60_000;

/**
 * Maximum number of entries kept in the metadata cache.
 *
 * @internal
 */
export const CACHE_MAX_ENTRIES = 256;

/**
 * Default retention for a disk-backed {@link "../http/persistent-cache"} entry, in
 * milliseconds. Decoupled from {@link CACHE_TTL_MS}: the in-memory TTL keeps a single process
 * from serving minutes-stale data, whereas the persistent cache exists so a target resolved
 * once still resolves on a later, offline launch — that wants days, not minutes.
 *
 * @internal
 */
export const PERSISTENT_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * User-agent value sent on every HTTP request.
 *
 * @internal
 */
export const USER_AGENT = "minecraft-kit/0.1";

/**
 * Default launcher brand sent through `${launcher_name}`.
 *
 * @internal
 */
export const DEFAULT_LAUNCHER_NAME = "minecraft-kit";

/**
 * Default launcher version sent through `${launcher_version}`.
 *
 * @internal
 */
export const DEFAULT_LAUNCHER_VERSION = "0.1.0";

/**
 * Default min heap size in megabytes.
 *
 * @internal
 */
export const DEFAULT_MIN_MB = 1024;

/**
 * Default max heap size in megabytes.
 *
 * @internal
 */
export const DEFAULT_MAX_MB = 4096;

/**
 * Time after a SIGTERM before escalating to SIGKILL when aborting a launch.
 *
 * @internal
 */
export const DEFAULT_KILL_GRACE_MS = 5_000;

/**
 * Throttle interval for emitting download:progress events (in milliseconds).
 *
 * @internal
 */
export const PROGRESS_EVENT_INTERVAL_MS = 100;

/**
 * Maximum number of stderr lines retained from a Forge processor for diagnostics.
 *
 * @internal
 */
export const MAX_PROCESSOR_STDERR_LINES = 20;

/**
 * Maximum bytes per line emitted by {@link ChildProcessSpawner}. Lines longer than this
 * are split: a Minecraft crash that prints megabytes of unbroken text should not exhaust
 * memory inside the launcher.
 *
 * @internal
 */
export const SPAWNER_MAX_LINE_BYTES = 64 * 1024;
