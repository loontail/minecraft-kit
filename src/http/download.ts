import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DOWNLOAD_IDLE_TIMEOUT_MS, HTTP_RETRY_MAX } from "../constants/defaults";
import { type CheckpointSources, checkpoint } from "../core/abort";
import { isMinecraftKitError, MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { ensureDir } from "../core/fs";
import { sha1OfFile } from "../core/hash";
import { withOptionalPauseController, withOptionalSignal } from "../core/optional";
import type { PauseController } from "../core/pause-controller";
import { isHttpRetryable, withRetry } from "../core/retry";
import type { ProgressListener } from "../types/events";
import { EventTypes } from "../types/events";
import type { HttpClient } from "../types/http";

/**
 * Inputs to {@link downloadFile}.
 *
 * `url` accepts either a single string or a `readonly string[]` of mirror URLs. When an
 * array is passed, URLs are tried sequentially: each URL is attempted with the full retry
 * policy, and the next URL is only consulted when the previous one's retries are
 * exhausted. Passing a single string is identical to passing a single-element array.
 *
 * @internal
 */
export type DownloadFileInput = {
  readonly url: string | readonly string[];
  readonly target: string;
  readonly expectedSha1?: string;
  readonly expectedSize?: number;
  readonly category?: string;
  readonly signal?: AbortSignal;
  readonly onEvent?: ProgressListener;
  /** Checked between chunks; pauses an in-flight download without aborting. */
  readonly pauseController?: PauseController;
  /**
   * Optional host allow-list. When set, downloads whose hostname does not match any entry
   * are rejected before fetch. Entries support a leading wildcard label, e.g.
   * `"*.minecraft.net"` matches `"piston-data.minecraft.net"`. Hostnames are compared
   * case-insensitively.
   */
  readonly hostAllowList?: readonly string[];
};

/**
 * Outputs from a successful download.
 *
 * @internal
 */
export type DownloadFileResult = {
  readonly bytesDownloaded: number;
  readonly sha1: string;
  readonly skipped: boolean;
};

/**
 * Stream a URL to a file with on-the-fly hash verification, atomic rename, retries, and
 * progress events. Skips the download when the destination already exists with matching
 * size + sha1. When multiple mirror URLs are supplied, they are tried sequentially with
 * a fresh retry budget per URL; only when every URL is exhausted is the operation
 * considered failed.
 *
 * @internal
 */
export const downloadFile = async (
  http: HttpClient,
  input: DownloadFileInput,
): Promise<DownloadFileResult> => {
  const urls = normalizeDownloadUrls(input.url);
  for (const url of urls) assertSafeDownloadUrl(url, input.hostAllowList);
  const primaryUrl = urls[0];
  const baseFileRef = {
    target: input.target,
    ...(input.category !== undefined ? { category: input.category } : {}),
  };
  if (input.expectedSha1 !== undefined) {
    const existing = await checkExistingFile(input.target, input.expectedSha1, input.expectedSize);
    if (existing.matches) {
      input.onEvent?.({
        type: EventTypes.DOWNLOAD_SKIPPED,
        file: { url: primaryUrl, ...baseFileRef },
      });
      return { bytesDownloaded: 0, sha1: existing.sha1, skipped: true };
    }
  }
  await ensureDir(path.dirname(input.target));
  const tmp = `${input.target}.${crypto.randomBytes(4).toString("hex")}.download`;
  const failures: unknown[] = [];
  for (const url of urls) {
    try {
      return await attemptUrlWithRetry(http, input, url, baseFileRef, tmp);
    } catch (error) {
      if (isFatalForFallback(error)) {
        throw error;
      }
      failures.push(error);
    }
  }
  throw buildAggregateDownloadError(urls, input.target, failures);
};

/**
 * Non-empty tuple of URL strings — the type-level guarantee returned by
 * {@link normalizeDownloadUrls} so callers can index `[0]` without a cast.
 *
 * @internal
 */
export type NonEmptyUrlList = readonly [string, ...string[]];

/**
 * Normalise a `string | readonly string[]` URL input into a non-empty tuple. Throws
 * `INVALID_INPUT` for an empty array — callers must always supply at least one URL.
 *
 * @internal
 */
const normalizeDownloadUrls = (url: string | readonly string[]): NonEmptyUrlList => {
  if (typeof url === "string") return [url];
  if (url.length === 0) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      "Download URL list is empty; at least one URL is required",
    );
  }
  return url as NonEmptyUrlList;
};

/**
 * Pick the primary (first) URL out of a `string | readonly string[]` for display, events,
 * and verification reports. Throws `INVALID_INPUT` for an empty array.
 *
 * @internal
 */
export const pickPrimaryDownloadUrl = (url: string | readonly string[]): string => {
  return normalizeDownloadUrls(url)[0];
};

const attemptUrlWithRetry = (
  http: HttpClient,
  input: DownloadFileInput,
  url: string,
  baseFileRef: { readonly target: string; readonly category?: string },
  tmp: string,
): Promise<DownloadFileResult> => {
  const fileRef = { url, ...baseFileRef };
  return withRetry(async () => streamOneAttempt(http, input, url, fileRef, tmp), isHttpRetryable, {
    ...withOptionalSignal(input.signal),
    onAttemptFailed: (error, attempt) => {
      input.onEvent?.({
        type: EventTypes.DOWNLOAD_FAILED,
        file: fileRef,
        error: error instanceof Error ? error : new Error(String(error)),
        willRetry: isHttpRetryable(error) && attempt < HTTP_RETRY_MAX - 1,
      });
    },
  });
};

const streamOneAttempt = async (
  http: HttpClient,
  input: DownloadFileInput,
  url: string,
  fileRef: { readonly url: string; readonly target: string; readonly category?: string },
  tmp: string,
): Promise<DownloadFileResult> => {
  input.onEvent?.({
    type: EventTypes.DOWNLOAD_STARTED,
    file: fileRef,
    expectedSize: input.expectedSize ?? 0,
  });
  const startedAt = Date.now();
  let bytesDownloaded = 0;
  const hash = crypto.createHash("sha1");
  // why: this attempt owns the request, so it also owns tearing it down. The controller is chained
  // into the request next to the caller's signal and aborted by the `finally` below on every exit
  // that leaves the body undrained, so undici releases the socket instead of keeping a half-open
  // body with a locked reader.
  const teardown = new AbortController();
  const response = await http.request(url, {
    signal:
      input.signal === undefined
        ? teardown.signal
        : AbortSignal.any([input.signal, teardown.signal]),
  });
  let completed = false;
  try {
    assertSafeRedirectTarget(url, response.url, input.hostAllowList);
    const contentLength = Number(response.headers["content-length"] ?? "0");
    const total = input.expectedSize ?? (Number.isFinite(contentLength) ? contentLength : 0);
    const checkpointSources: CheckpointSources = {
      ...withOptionalSignal(input.signal),
      ...withOptionalPauseController(input.pauseController),
    };
    const counting = countingByteStream(response.stream(), checkpointSources, (chunk) => {
      bytesDownloaded += chunk.byteLength;
      hash.update(chunk);
      input.onEvent?.({
        type: EventTypes.DOWNLOAD_PROGRESS,
        file: fileRef,
        bytesDownloaded,
        totalBytes: total,
      });
    });
    try {
      await pipeline(Readable.from(counting), createWriteStream(tmp));
    } catch (cause) {
      await safeUnlink(tmp);
      // why: the source side of the pipeline raises domain errors of its own (the idle-timeout
      // NETWORK_TIMEOUT, an abort's LAUNCH_ABORTED). Re-wrapping them as FILESYSTEM_WRITE_ERROR
      // would make a retryable stall un-retryable and an abort look like a disk fault.
      if (isMinecraftKitError(cause)) throw cause;
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.FILESYSTEM_WRITE_ERROR,
        `Failed to write download: ${input.target}`,
        { cause, context: { filePath: input.target, url } },
      );
    }
    const computedSha1 = hash.digest("hex");
    if (input.expectedSize !== undefined && bytesDownloaded !== input.expectedSize) {
      await safeUnlink(tmp);
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.INTEGRITY_SIZE_MISMATCH,
        `Size mismatch for ${url}`,
        {
          context: {
            url,
            expectedSize: input.expectedSize,
            actualSize: bytesDownloaded,
          },
        },
      );
    }
    if (input.expectedSha1 !== undefined && computedSha1 !== input.expectedSha1) {
      await safeUnlink(tmp);
      input.onEvent?.({
        type: EventTypes.INTEGRITY_MISMATCH,
        file: fileRef,
        algorithm: "sha1",
        expected: input.expectedSha1,
        actual: computedSha1,
      });
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH,
        `SHA-1 mismatch for ${url}`,
        {
          context: {
            url,
            expectedHash: input.expectedSha1,
            actualHash: computedSha1,
          },
        },
      );
    }
    try {
      await fs.rename(tmp, input.target);
    } catch (cause) {
      await safeUnlink(tmp);
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.FILESYSTEM_WRITE_ERROR,
        `Failed to finalize download: ${input.target}`,
        { cause, context: { filePath: input.target } },
      );
    }
    input.onEvent?.({
      type: EventTypes.DOWNLOAD_COMPLETED,
      file: fileRef,
      durationMs: Date.now() - startedAt,
      bytes: bytesDownloaded,
    });
    if (input.expectedSha1 !== undefined) {
      input.onEvent?.({
        type: EventTypes.INTEGRITY_VERIFIED,
        file: fileRef,
        algorithm: "sha1",
        hash: computedSha1,
      });
    }
    completed = true;
    return { bytesDownloaded, sha1: computedSha1, skipped: false };
  } finally {
    if (!completed) teardown.abort();
  }
};

/**
 * Errors that should short-circuit the mirror fallback loop. An abort or an obviously
 * caller-induced INVALID_INPUT is final; there is no point trying the next mirror.
 */
const isFatalForFallback = (error: unknown): boolean => {
  if (!isMinecraftKitError(error)) return false;
  return (
    error.code === MinecraftKitErrorCodes.NETWORK_ABORTED ||
    error.code === MinecraftKitErrorCodes.LAUNCH_ABORTED ||
    error.code === MinecraftKitErrorCodes.INVALID_INPUT
  );
};

const buildAggregateDownloadError = (
  urls: NonEmptyUrlList,
  target: string,
  failures: readonly unknown[],
): MinecraftKitError => {
  const lastFailure = failures[failures.length - 1];
  if (urls.length === 1) {
    return new MinecraftKitError(
      MinecraftKitErrorCodes.NETWORK_HTTP_ERROR,
      `Download failed for ${target}`,
      {
        cause: lastFailure,
        context: { urls: [...urls], filePath: target, url: urls[0] },
      },
    );
  }
  const cause = new AggregateError(
    failures.map(toError),
    `All ${urls.length} mirror URLs failed for ${target}`,
  );
  return new MinecraftKitError(
    MinecraftKitErrorCodes.NETWORK_HTTP_ERROR,
    `All ${urls.length} mirror URLs failed for ${target}`,
    {
      cause,
      context: { urls: [...urls], filePath: target },
    },
  );
};

const toError = (value: unknown): Error => {
  return value instanceof Error ? value : new Error(String(value));
};

const checkExistingFile = async (
  target: string,
  expectedSha1: string,
  expectedSize: number | undefined,
): Promise<{ readonly matches: boolean; readonly sha1: string }> => {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(target);
  } catch {
    return { matches: false, sha1: "" };
  }
  if (!stat.isFile()) {
    return { matches: false, sha1: "" };
  }
  if (expectedSize !== undefined && stat.size !== expectedSize) {
    return { matches: false, sha1: "" };
  }
  const sha1 = await sha1OfFile(target);
  return { matches: sha1 === expectedSha1, sha1 };
};

/**
 * Best-effort removal of a partial download's `.download` temp file.
 *
 * Called from the error paths of {@link downloadFile} immediately before re-throwing
 * the real `MinecraftKitError`. We deliberately swallow `fs.unlink` failures so the
 * caller still sees the primary cause — e.g. the integrity mismatch or write error —
 * rather than a misleading cleanup error. ENOENT is the expected case (the temp file
 * was already renamed into place, or never created), but any other failure here is
 * still less informative than the original error and would only mask it.
 *
 * @internal
 */
const safeUnlink = async (filePath: string): Promise<void> => {
  try {
    await fs.unlink(filePath);
  } catch {
    /* best-effort cleanup; preserve the primary error above */
  }
};

async function* countingByteStream(
  source: AsyncIterable<Uint8Array>,
  sources: CheckpointSources,
  onChunk: (chunk: Uint8Array) => void,
): AsyncGenerator<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  let drained = false;
  try {
    for (;;) {
      // why: pause and abort are awaited BEFORE the idle deadline is armed, so a transfer parked
      // at a chunk boundary is never timed at all, and no further chunk is pulled from the socket
      // until resume().
      await checkpoint(sources, "Download aborted by signal");
      const result = await readWithIdleDeadline(iterator);
      if (result.done === true) {
        drained = true;
        return;
      }
      // why: and again before the chunk is handed on, so a pause issued while this read was
      // already in flight still freezes the download at the byte count the caller last saw.
      await checkpoint(sources, "Download aborted by signal");
      onChunk(result.value);
      yield result.value;
    }
  } finally {
    if (!drained) closeAbandonedSource(iterator);
  }
}

/**
 * Close a source this generator is abandoning mid-stream. This is the AsyncIteratorClose step
 * `for await` performs on your behalf; the loop above drives the iterator by hand, so it has to
 * do it itself.
 *
 * This is what runs the source's own `finally` (in `FetchHttpResponse.stream`, the
 * `reader.releaseLock()`). It is not awaited: `iterator.return()` is queued behind any pending
 * `next()`, so a half-open body would block this `finally` forever and swallow the error the caller
 * must see. That case is covered by the attempt-level teardown in {@link streamOneAttempt}, which
 * cancels the request and thereby settles the pending read.
 */
const closeAbandonedSource = (iterator: AsyncIterator<Uint8Array>): void => {
  void iterator.return?.().catch(() => {
    /* best-effort close; the attempt-level abort is the real teardown */
  });
};

/**
 * Await one chunk, failing with a retryable `NETWORK_TIMEOUT` when the body delivers nothing
 * for {@link DOWNLOAD_IDLE_TIMEOUT_MS}. See that constant for why the header timeout in
 * {@link "./client"} cannot cover this. Closing the abandoned read is the caller's job — see
 * {@link closeAbandonedSource}; this function only races the deadline.
 */
const readWithIdleDeadline = async (
  iterator: AsyncIterator<Uint8Array>,
): Promise<IteratorResult<Uint8Array>> => {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new MinecraftKitError(
          MinecraftKitErrorCodes.NETWORK_TIMEOUT,
          `Download stalled: no data received for ${DOWNLOAD_IDLE_TIMEOUT_MS}ms`,
          { context: { timeoutMs: DOWNLOAD_IDLE_TIMEOUT_MS } },
        ),
      );
    }, DOWNLOAD_IDLE_TIMEOUT_MS);
    timer.unref();
  });
  try {
    return await Promise.race([iterator.next(), deadline]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Reject download URLs that aren't plain HTTP(S) — and optionally, hosts outside an
 * allow-list — before they reach `fetch`.
 *
 * Manifests are loaded over the network: an attacker controlling DNS or sitting in the
 * middle could rewrite `library.url` to `file:///etc/passwd`, and the streaming `fetch`
 * would happily follow it. Restricting to `http:`/`https:` blocks `file:`, `data:`, and
 * other schemes that would let `fetch` read local files or follow data URIs. Callers
 * that ship into a hostile environment can additionally pin to a host allow-list.
 *
 * @internal
 */
const assertSafeDownloadUrl = (url: string, allowList: readonly string[] | undefined): void => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `Download URL is not parseable: ${url}`,
      {
        context: { url },
      },
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `Download URL must use http(s); refusing scheme ${parsed.protocol}`,
      { context: { url, scheme: parsed.protocol } },
    );
  }
  if (allowList !== undefined && !matchesHostAllowList(parsed.hostname, allowList)) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `Download URL host is not in the allow-list: ${parsed.hostname}`,
      { context: { url, host: parsed.hostname } },
    );
  }
};

/**
 * Reject a download whose response landed on a host outside the allow-list after following
 * redirects.
 *
 * `assertSafeDownloadUrl` only sees the pre-redirect URL, and the HTTP client follows
 * redirects, so an allow-listed host could 30x-redirect the download to an attacker-
 * controlled host. This re-validates the final `response.url` once it is known and before
 * any bytes are streamed to disk. Skips when no allow-list is in effect, when the final URL
 * is unavailable, or when it equals the requested URL (no redirect happened).
 *
 * @internal
 */
const assertSafeRedirectTarget = (
  requestedUrl: string,
  finalUrl: string,
  allowList: readonly string[] | undefined,
): void => {
  if (allowList === undefined || finalUrl === "" || finalUrl === requestedUrl) return;
  let parsed: URL;
  try {
    parsed = new URL(finalUrl);
  } catch {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `Download redirect target is not parseable: ${finalUrl}`,
      { context: { url: requestedUrl, finalUrl } },
    );
  }
  if (!matchesHostAllowList(parsed.hostname, allowList)) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `Download redirected to a host not in the allow-list: ${parsed.hostname}`,
      { context: { url: requestedUrl, finalUrl, host: parsed.hostname } },
    );
  }
};

const matchesHostAllowList = (hostname: string, allowList: readonly string[]): boolean => {
  const host = hostname.toLowerCase();
  return allowList.some((entry) => matchesHostEntry(host, entry.toLowerCase()));
};

const matchesHostEntry = (host: string, entry: string): boolean => {
  if (entry.startsWith("*.")) {
    const suffix = entry.slice(1);
    return host === entry.slice(2) || host.endsWith(suffix);
  }
  return host === entry;
};
