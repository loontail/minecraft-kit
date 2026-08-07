/**
 * HTTP request timeout for metadata calls, in milliseconds.
 *
 * @internal
 */
export const HTTP_TIMEOUT_MS = 30_000;

/**
 * Maximum time a download body may go without delivering a single byte before the attempt is
 * failed with `NETWORK_TIMEOUT`, in milliseconds.
 *
 * why: {@link HTTP_TIMEOUT_MS} is cleared the moment response headers arrive, so a half-open
 * connection — captive portal, Wi-Fi handoff, overloaded CDN edge — leaves the body read
 * pending forever with no error and no progress event. This is an *idle* deadline, not a
 * total-duration one: a slow but progressing download is never cut off.
 *
 * Interaction with a `PauseController`: the deadline is armed only around a read, and the pause is
 * awaited before arming it, so a transfer parked at a chunk boundary is never timed. A `pause()`
 * issued while a read is already in flight is a different matter — it is not observed until that
 * read delivers a chunk, so a connection that goes quiet in between still trips the deadline, and
 * the retry path does not consult the pause controller.
 *
 * @internal
 */
export const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

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
 * Concurrency for verification hashing.
 *
 * why: deliberately far lower than {@link DOWNLOAD_CONCURRENCY} — verification is local-I/O
 * bound rather than latency bound, so a high fan-out only thrashes a spinning disk instead of
 * hiding round-trips.
 *
 * @internal
 */
export const VERIFY_CONCURRENCY = 8;

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
 * Bound to the real package version through the build-time `__PKG_VERSION__` define: the
 * hand-written literal here read `minecraft-kit/0.1` eight minor releases in, so every request to
 * Mojang/Fabric/Forge advertised a version that had not existed for months.
 *
 * @internal
 */
export const USER_AGENT = `minecraft-kit/${__PKG_VERSION__}`;

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
