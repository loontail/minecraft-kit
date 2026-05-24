import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HTTP_RETRY_MAX } from "../constants/defaults";
import { type CheckpointSources, checkpoint } from "../core/abort";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { ensureDir } from "../core/fs";
import { withOptionalPauseController, withOptionalSignal } from "../core/optional";
import type { PauseController } from "../core/pause-controller";
import { isHttpRetryable, withRetry } from "../core/retry";
import { EventTypes } from "../types/events";
import type { ProgressListener } from "../types/events";
import type { HttpClient } from "../types/http";

/**
 * Inputs to {@link downloadFile}.
 *
 * @internal
 */
export type DownloadFileInput = {
  readonly url: string;
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
 * size + sha1.
 *
 * @internal
 */
export const downloadFile = async (
  http: HttpClient,
  input: DownloadFileInput,
): Promise<DownloadFileResult> => {
  assertSafeDownloadUrl(input.url, input.hostAllowList);
  const fileRef = {
    url: input.url,
    target: input.target,
    ...(input.category !== undefined ? { category: input.category } : {}),
  };
  if (input.expectedSha1 !== undefined) {
    const existing = await checkExistingFile(input.target, input.expectedSha1, input.expectedSize);
    if (existing.matches) {
      input.onEvent?.({ type: EventTypes.DOWNLOAD_SKIPPED, file: fileRef });
      return { bytesDownloaded: 0, sha1: existing.sha1, skipped: true };
    }
  }
  await ensureDir(path.dirname(input.target));
  const tmp = `${input.target}.${crypto.randomBytes(4).toString("hex")}.download`;
  return withRetry(
    async () => {
      input.onEvent?.({
        type: EventTypes.DOWNLOAD_STARTED,
        file: fileRef,
        expectedSize: input.expectedSize ?? 0,
      });
      const startedAt = Date.now();
      let bytesDownloaded = 0;
      const hash = crypto.createHash("sha1");
      const response = await http.request(input.url, {
        ...withOptionalSignal(input.signal),
      });
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
        throw new MinecraftKitError(
          MinecraftKitErrorCodes.FILESYSTEM_WRITE_ERROR,
          `Failed to write download: ${input.target}`,
          { cause, context: { filePath: input.target, url: input.url } },
        );
      }
      const computedSha1 = hash.digest("hex");
      if (input.expectedSize !== undefined && bytesDownloaded !== input.expectedSize) {
        await safeUnlink(tmp);
        throw new MinecraftKitError(
          MinecraftKitErrorCodes.INTEGRITY_SIZE_MISMATCH,
          `Size mismatch for ${input.url}`,
          {
            context: {
              url: input.url,
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
          `SHA-1 mismatch for ${input.url}`,
          {
            context: {
              url: input.url,
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
      return { bytesDownloaded, sha1: computedSha1, skipped: false };
    },
    isHttpRetryable,
    {
      ...withOptionalSignal(input.signal),
      onAttemptFailed: (error, attempt) => {
        input.onEvent?.({
          type: EventTypes.DOWNLOAD_FAILED,
          file: fileRef,
          error: error instanceof Error ? error : new Error(String(error)),
          willRetry: isHttpRetryable(error) && attempt < HTTP_RETRY_MAX - 1,
        });
      },
    },
  );
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
  const buf = await fs.readFile(target);
  const sha1 = crypto.createHash("sha1").update(buf).digest("hex");
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
  for await (const chunk of source) {
    await checkpoint(sources, "Download aborted by signal");
    onChunk(chunk);
    yield chunk;
  }
}

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
