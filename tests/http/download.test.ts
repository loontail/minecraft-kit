import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleepReal } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DOWNLOAD_HOST_ALLOWLIST } from "../../src/constants/api";
import {
  DOWNLOAD_IDLE_TIMEOUT_MS,
  HTTP_RETRY_BACKOFF_CAP_MS,
  HTTP_RETRY_MAX,
} from "../../src/constants/defaults";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../../src/core/errors";
import { PauseController } from "../../src/core/pause-controller";
import { downloadFile } from "../../src/http/download";
import type { ProgressEvent } from "../../src/types/events";
import type { HttpClient, HttpResponse } from "../../src/types/http";
import { FakeHttpClient } from "../helpers/fake-http";
import { sha1OfBytes } from "../helpers/hash";

const neverResolves = (): Promise<never> => new Promise<never>(() => {});

/** Sends headers plus one chunk, then never writes again — a half-open connection. */
const stallingHttp = (counter: { count: number }): HttpClient => ({
  async request(url): Promise<HttpResponse> {
    counter.count++;
    return {
      status: 200,
      headers: {},
      url,
      async text() {
        return "";
      },
      async json<T = unknown>(): Promise<T> {
        return null as T;
      },
      async bytes() {
        return new Uint8Array();
      },
      async *stream() {
        yield new TextEncoder().encode("partial");
        await neverResolves();
      },
    };
  },
});

/** Sends headers and then never writes a single byte. */
const neverYieldingHttp = (counter: { count: number }): HttpClient => ({
  async request(url): Promise<HttpResponse> {
    counter.count++;
    return {
      status: 200,
      headers: {},
      url,
      async text() {
        return "";
      },
      async json<T = unknown>(): Promise<T> {
        return null as T;
      },
      async bytes() {
        return new Uint8Array();
      },
      // why: the yield is unreachable — the await never settles — but it keeps this an async
      // generator, which is what the HttpResponse contract requires.
      async *stream() {
        await neverResolves();
        yield new Uint8Array();
      },
    };
  },
});

type TeardownProbe = {
  requests: number;
  closed: number;
  signals: (AbortSignal | undefined)[];
};

/**
 * Half-open body modelled on undici: the pending read only ever settles when the request signal
 * aborts. `closed` counts how often the body generator's `finally` ran, i.e. how often the
 * response-body reader lock would have been released in the real client.
 */
const stallingHttpWithTeardownProbe = (probe: TeardownProbe): HttpClient => ({
  async request(url, options): Promise<HttpResponse> {
    probe.requests++;
    const signal = options?.signal;
    probe.signals.push(signal);
    return {
      status: 200,
      headers: {},
      url,
      async text() {
        return "";
      },
      async json<T = unknown>(): Promise<T> {
        return null as T;
      },
      async bytes() {
        return new Uint8Array();
      },
      async *stream() {
        try {
          yield new TextEncoder().encode("partial");
          await new Promise<never>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new Error("request aborted")), {
              once: true,
            });
          });
        } finally {
          probe.closed++;
        }
      },
    };
  },
});

/** Let queued teardown microtasks/immediates run before asserting on them. */
const flushTurns = async (turns = 5): Promise<void> => {
  for (let turn = 0; turn < turns; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const leftoverTempFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await fs.readdir(directory);
  return entries.filter((name) => name.endsWith(".download"));
};

/** Real-time budget for the fake-timer drain / wait helpers, well under the per-test timeout. */
const DRAIN_BUDGET_MS = 10_000;

/**
 * Advance faked `setTimeout`s until `promise` settles, sleeping on a *real* timer between steps.
 * `downloadFile` interleaves the faked timers (idle deadline, retry backoff) with real filesystem
 * I/O, and the next deadline is only armed once the previous attempt's temp-file cleanup comes back
 * from the thread pool.
 *
 * why: the budget is real milliseconds, not loop iterations. A `setImmediate` chain can spin through
 * hundreds of iterations in a couple of milliseconds without a single fs callback landing, and once
 * such a loop gives up nothing advances the fake clock again — the download then hangs until the
 * test times out. `node:timers/promises` is deliberately used: `vi.useFakeTimers` replaces the
 * global `setTimeout`, but not that module's, so this really waits.
 */
const drainFakeTimers = async (promise: Promise<unknown>): Promise<void> => {
  let settled = false;
  const mark = (): void => {
    settled = true;
  };
  promise.then(mark, mark);
  const startedAt = Date.now();
  while (!settled && Date.now() - startedAt < DRAIN_BUDGET_MS) {
    await vi.advanceTimersByTimeAsync(DOWNLOAD_IDLE_TIMEOUT_MS + HTTP_RETRY_BACKOFF_CAP_MS);
    await sleepReal(1);
  }
};

/** Wait, on real time, for a condition driven by real I/O while the fake clock is frozen. */
const waitForReal = async (condition: () => boolean): Promise<void> => {
  const startedAt = Date.now();
  while (!condition() && Date.now() - startedAt < DRAIN_BUDGET_MS) {
    await sleepReal(1);
  }
};

/** HttpClient that reports a post-redirect final URL distinct from the requested one. */
const redirectingHttp = (requestedUrl: string, finalUrl: string, body: Uint8Array): HttpClient => ({
  async request(url): Promise<HttpResponse> {
    return {
      status: 200,
      headers: { "content-length": String(body.byteLength) },
      url: url === requestedUrl ? finalUrl : url,
      async text() {
        return new TextDecoder().decode(body);
      },
      async json<T = unknown>(): Promise<T> {
        return JSON.parse(new TextDecoder().decode(body)) as T;
      },
      async bytes() {
        return body;
      },
      async *stream() {
        yield body;
      },
    };
  },
});

describe("downloadFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-dl-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes file and reports events", async () => {
    const body = new TextEncoder().encode("hello world");
    const expectedSha1 = sha1OfBytes(body);
    const http = new FakeHttpClient().on("https://x/", { body });
    const target = path.join(tmpDir, "x");
    const events: ProgressEvent[] = [];
    const result = await downloadFile(http, {
      url: "https://x/",
      target,
      expectedSha1,
      expectedSize: body.byteLength,
      onEvent: (e) => events.push(e),
    });
    expect(result.bytesDownloaded).toBe(body.byteLength);
    expect(result.skipped).toBe(false);
    expect(await fs.readFile(target, "utf8")).toBe("hello world");
    expect(events.some((e) => e.type === "download:started")).toBe(true);
    expect(events.some((e) => e.type === "download:completed")).toBe(true);
    expect(events.some((e) => e.type === "integrity:verified")).toBe(true);
  });

  it("skips when destination is already valid", async () => {
    const body = new TextEncoder().encode("hello");
    const expectedSha1 = sha1OfBytes(body);
    const target = path.join(tmpDir, "x");
    await fs.writeFile(target, body);
    const http = new FakeHttpClient();
    const result = await downloadFile(http, {
      url: "https://x/",
      target,
      expectedSha1,
      expectedSize: body.byteLength,
    });
    expect(result.skipped).toBe(true);
    expect(http.requests.length).toBe(0);
  });

  it("rejects on hash mismatch", async () => {
    const body = new TextEncoder().encode("abc");
    const http = new FakeHttpClient().on("https://x/", { body });
    const target = path.join(tmpDir, "x");
    await expect(
      downloadFile(http, {
        url: "https://x/",
        target,
        expectedSha1: "0".repeat(40),
        expectedSize: 3,
      }),
    ).rejects.toBeInstanceOf(MinecraftKitError);
  });

  it("rejects on size mismatch", async () => {
    const body = new TextEncoder().encode("abc");
    const http = new FakeHttpClient().on("https://x/", { body });
    const target = path.join(tmpDir, "x");
    await expect(
      downloadFile(http, {
        url: "https://x/",
        target,
        expectedSize: 99,
      }),
    ).rejects.toBeInstanceOf(MinecraftKitError);
  });

  it("rejects non-http(s) URL schemes before issuing a request", async () => {
    const http = new FakeHttpClient();
    const target = path.join(tmpDir, "x");
    await expect(downloadFile(http, { url: "file:///etc/passwd", target })).rejects.toThrow(
      /INVALID_INPUT|http\(s\)/,
    );
    await expect(downloadFile(http, { url: "data:text/plain,oops", target })).rejects.toThrow(
      /INVALID_INPUT|http\(s\)/,
    );
    expect(http.requests.length).toBe(0);
  });

  it("rejects unparseable URLs", async () => {
    const http = new FakeHttpClient();
    const target = path.join(tmpDir, "x");
    await expect(downloadFile(http, { url: "not a url at all", target })).rejects.toThrow(
      /INVALID_INPUT|not parseable/,
    );
    expect(http.requests.length).toBe(0);
  });

  it("rejects URLs whose host is not in the allow-list", async () => {
    const body = new TextEncoder().encode("ok");
    const http = new FakeHttpClient().on("https://evil.example.com/", { body });
    const target = path.join(tmpDir, "x");
    await expect(
      downloadFile(http, {
        url: "https://evil.example.com/",
        target,
        hostAllowList: ["*.minecraft.net", "maven.minecraftforge.net"],
      }),
    ).rejects.toThrow(/allow-list/);
    expect(http.requests.length).toBe(0);
  });

  it("accepts URLs whose host matches a wildcard allow-list entry", async () => {
    const body = new TextEncoder().encode("ok");
    const expectedSha1 = sha1OfBytes(body);
    const http = new FakeHttpClient().on("https://piston-data.minecraft.net/file", { body });
    const target = path.join(tmpDir, "x");
    const result = await downloadFile(http, {
      url: "https://piston-data.minecraft.net/file",
      target,
      expectedSha1,
      hostAllowList: ["*.minecraft.net"],
    });
    expect(result.bytesDownloaded).toBe(body.byteLength);
  });

  it("rejects a redirect whose final host is outside the allow-list", async () => {
    const body = new TextEncoder().encode("payload");
    const http = redirectingHttp(
      "https://piston-data.minecraft.net/file",
      "https://evil.example.com/file",
      body,
    );
    const target = path.join(tmpDir, "x");
    await expect(
      downloadFile(http, {
        url: "https://piston-data.minecraft.net/file",
        target,
        hostAllowList: ["*.minecraft.net"],
      }),
    ).rejects.toThrow(/redirected to a host not in the allow-list/);
    await expect(fs.stat(target)).rejects.toThrow();
  });

  it("tears down the request when a redirect target fails the allow-list", async () => {
    const body = new TextEncoder().encode("payload");
    const redirecting = redirectingHttp(
      "https://piston-data.minecraft.net/file",
      "https://evil.example.com/file",
      body,
    );
    const signals: (AbortSignal | undefined)[] = [];
    const http: HttpClient = {
      async request(url, options): Promise<HttpResponse> {
        signals.push(options?.signal);
        return redirecting.request(url, options);
      },
    };

    await expect(
      downloadFile(http, {
        url: "https://piston-data.minecraft.net/file",
        target: path.join(tmpDir, "x"),
        hostAllowList: ["*.minecraft.net"],
      }),
    ).rejects.toThrow(/redirected to a host not in the allow-list/);
    // The body was never read, so nothing else can cancel the request.
    expect(signals.every((signal) => signal?.aborted === true)).toBe(true);
  });

  it("accepts a redirect whose final host is still in the allow-list", async () => {
    const body = new TextEncoder().encode("payload");
    const expectedSha1 = sha1OfBytes(body);
    const http = redirectingHttp(
      "https://piston-meta.mojang.com/file",
      "https://piston-data.mojang.com/file",
      body,
    );
    const target = path.join(tmpDir, "x");
    const result = await downloadFile(http, {
      url: "https://piston-meta.mojang.com/file",
      target,
      expectedSha1,
      hostAllowList: ["*.mojang.com"],
    });
    expect(result.bytesDownloaded).toBe(body.byteLength);
  });

  it("default allow-list rejects arbitrary hosts but accepts the Mojang/Fabric/Forge ecosystem", async () => {
    const body = new TextEncoder().encode("ok");
    const expectedSha1 = sha1OfBytes(body);
    const allowed = [
      "https://piston-data.mojang.com/a",
      "https://resources.download.minecraft.net/b",
      "https://maven.fabricmc.net/c",
      "https://maven.minecraftforge.net/d",
    ];
    for (const url of allowed) {
      const http = new FakeHttpClient().on(url, { body });
      const result = await downloadFile(http, {
        url,
        target: path.join(tmpDir, encodeURIComponent(url)),
        expectedSha1,
        hostAllowList: DEFAULT_DOWNLOAD_HOST_ALLOWLIST,
      });
      expect(result.bytesDownloaded).toBe(body.byteLength);
    }
    const http = new FakeHttpClient().on("https://evil.example.com/x", { body });
    await expect(
      downloadFile(http, {
        url: "https://evil.example.com/x",
        target: path.join(tmpDir, "evil"),
        hostAllowList: DEFAULT_DOWNLOAD_HOST_ALLOWLIST,
      }),
    ).rejects.toThrow(/allow-list/);
    expect(http.requests.length).toBe(0);
  });

  it("falls back to the next mirror URL when the first one fails", async () => {
    const body = new TextEncoder().encode("mirror-ok");
    const expectedSha1 = sha1OfBytes(body);
    const http = new FakeHttpClient()
      .on("https://primary/file", {
        error: () =>
          new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_HTTP_ERROR, "primary 404", {
            context: { url: "https://primary/file", httpStatus: 404 },
          }),
      })
      .on("https://mirror/file", { body });
    const target = path.join(tmpDir, "x");
    const events: ProgressEvent[] = [];
    const result = await downloadFile(http, {
      url: ["https://primary/file", "https://mirror/file"],
      target,
      expectedSha1,
      expectedSize: body.byteLength,
      onEvent: (e) => events.push(e),
    });
    expect(result.bytesDownloaded).toBe(body.byteLength);
    expect(result.skipped).toBe(false);
    expect(await fs.readFile(target, "utf8")).toBe("mirror-ok");
    const completed = events.find((e) => e.type === "download:completed");
    expect(completed && "file" in completed ? completed.file.url : undefined).toBe(
      "https://mirror/file",
    );
  });

  it("aggregates errors when every mirror URL fails", async () => {
    const http = new FakeHttpClient()
      .on("https://a/file", {
        error: () =>
          new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_HTTP_ERROR, "a 404", {
            context: { url: "https://a/file", httpStatus: 404 },
          }),
      })
      .on("https://b/file", {
        error: () =>
          new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_HTTP_ERROR, "b 404", {
            context: { url: "https://b/file", httpStatus: 404 },
          }),
      });
    const target = path.join(tmpDir, "x");
    let caught: unknown;
    try {
      await downloadFile(http, {
        url: ["https://a/file", "https://b/file"],
        target,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MinecraftKitError);
    const error = caught as MinecraftKitError;
    expect(error.code).toBe(MinecraftKitErrorCodes.NETWORK_HTTP_ERROR);
    expect(error.context.urls).toEqual(["https://a/file", "https://b/file"]);
    expect(error.cause).toBeInstanceOf(AggregateError);
    const aggregate = error.cause as AggregateError;
    expect(aggregate.errors.length).toBe(2);
  });

  it("rejects an empty URL array before issuing any request", async () => {
    const http = new FakeHttpClient();
    const target = path.join(tmpDir, "x");
    let caught: unknown;
    try {
      await downloadFile(http, { url: [], target });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MinecraftKitError);
    expect((caught as MinecraftKitError).code).toBe(MinecraftKitErrorCodes.INVALID_INPUT);
    expect(http.requests.length).toBe(0);
  });

  // KIT-P5: the only timer in FetchHttpClient covers response headers and is cleared the moment
  // fetch resolves, so a server that sends headers and then stops writing used to leave the body
  // read pending forever — no error, no progress event, and the pLimit slot held for good.
  describe("idle/stall timeout", () => {
    beforeEach(() => {
      // Only setTimeout is faked: node streams drive the write side through setImmediate /
      // nextTick, and faking those deadlocks `pipeline` before the deadline can ever fire.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("fails a stalled body with a retryable NETWORK_TIMEOUT and cleans up the temp file", async () => {
      const counter = { count: 0 };
      const target = path.join(tmpDir, "stalled");
      const promise = downloadFile(stallingHttp(counter), { url: "https://stall/", target });
      let caught: unknown;
      const settled = promise.catch((error: unknown) => {
        caught = error;
      });
      await drainFakeTimers(settled);
      await settled;

      expect(caught).toBeInstanceOf(MinecraftKitError);
      // The stall itself is NETWORK_TIMEOUT; `downloadFile` reports the exhausted-URL wrapper
      // and keeps the timeout as its cause. The retry count is what proves the timeout was
      // classified as retryable rather than swallowed.
      expect((caught as MinecraftKitError).cause).toMatchObject({
        code: MinecraftKitErrorCodes.NETWORK_TIMEOUT,
      });
      expect(counter.count).toBe(HTTP_RETRY_MAX);
      expect(await leftoverTempFiles(tmpDir)).toEqual([]);
      await expect(fs.stat(target)).rejects.toThrow();
      // Four retry attempts, each pumped through the fake clock, on a heavily parallel runner.
    }, 20_000);

    it("retries the URL from scratch and succeeds when the stream recovers", async () => {
      const body = new TextEncoder().encode("recovered");
      let attempt = 0;
      const http: HttpClient = {
        async request(url): Promise<HttpResponse> {
          attempt++;
          const stalls = attempt === 1;
          return {
            status: 200,
            headers: {},
            url,
            async text() {
              return "";
            },
            async json<T = unknown>(): Promise<T> {
              return null as T;
            },
            async bytes() {
              return body;
            },
            async *stream() {
              if (stalls) {
                yield body.slice(0, 3);
                await neverResolves();
              }
              yield body;
            },
          };
        },
      };
      const target = path.join(tmpDir, "recovered");
      const promise = downloadFile(http, {
        url: "https://flaky/",
        target,
        expectedSha1: sha1OfBytes(body),
      });
      await drainFakeTimers(promise);
      const result = await promise;
      expect(result.bytesDownloaded).toBe(body.byteLength);
      expect(attempt).toBe(2);
      expect(await fs.readFile(target, "utf8")).toBe("recovered");
    }, 20_000);

    // KIT-P11: the per-chunk pause checkpoint has to sit outside the timed read, or a pause
    // longer than the idle deadline would be reported as a stalled connection.
    it("does not trip the deadline while the caller holds the download paused", async () => {
      const chunk = new TextEncoder().encode("paused-ok");
      const http: HttpClient = {
        async request(url): Promise<HttpResponse> {
          return {
            status: 200,
            headers: {},
            url,
            async text() {
              return "";
            },
            async json<T = unknown>(): Promise<T> {
              return null as T;
            },
            async bytes() {
              return chunk;
            },
            async *stream() {
              yield chunk;
            },
          };
        },
      };
      const pauseController = new PauseController();
      pauseController.pause();
      const target = path.join(tmpDir, "paused");
      const promise = downloadFile(http, {
        url: "https://paused/",
        target,
        expectedSha1: sha1OfBytes(chunk),
        pauseController,
      });

      // Three times the deadline elapses while paused; if the checkpoint sat inside the timed
      // read this would reject with NETWORK_TIMEOUT instead of completing.
      await vi.advanceTimersByTimeAsync(DOWNLOAD_IDLE_TIMEOUT_MS * 3);
      pauseController.resume();
      await drainFakeTimers(promise);
      const result = await promise;
      expect(result.bytesDownloaded).toBe(chunk.byteLength);
      expect(await fs.readFile(target, "utf8")).toBe("paused-ok");
    });

    // The pause has to be awaited *before* the deadline is armed, not only after the first chunk
    // landed: a download paused before any byte arrived must not burn the retry budget.
    it("does not arm the idle deadline while a download paused before its first chunk waits", async () => {
      const counter = { count: 0 };
      const pauseController = new PauseController();
      pauseController.pause();
      const target = path.join(tmpDir, "paused-stall");
      let settled = false;
      const tracked = downloadFile(neverYieldingHttp(counter), {
        url: "https://paused-stall/",
        target,
        pauseController,
      })
        .catch(() => undefined)
        .then(() => {
          settled = true;
        });

      await waitForReal(() => counter.count > 0);
      await flushTurns(10);
      // The request is out and the attempt is parked on the pause: no idle deadline is armed, so
      // there is no timer that could fire while the user holds the transfer paused.
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(DOWNLOAD_IDLE_TIMEOUT_MS * 3);
      await flushTurns();
      expect(settled).toBe(false);
      expect(counter.count).toBe(1);

      pauseController.resume();
      await drainFakeTimers(tracked);
      await tracked;
      expect(counter.count).toBe(HTTP_RETRY_MAX);
    }, 20_000);

    it("aborts the request and closes a half-open body on every abandoned attempt", async () => {
      const probe: TeardownProbe = { requests: 0, closed: 0, signals: [] };
      const target = path.join(tmpDir, "half-open");
      const promise = downloadFile(stallingHttpWithTeardownProbe(probe), {
        url: "https://half-open/",
        target,
      });
      let caught: unknown;
      const settled = promise.catch((error: unknown) => {
        caught = error;
      });
      await drainFakeTimers(settled);
      await settled;
      await flushTurns();

      expect((caught as MinecraftKitError).cause).toMatchObject({
        code: MinecraftKitErrorCodes.NETWORK_TIMEOUT,
      });
      expect(probe.requests).toBe(HTTP_RETRY_MAX);
      expect(probe.signals.every((signal) => signal?.aborted === true)).toBe(true);
      expect(probe.closed).toBe(HTTP_RETRY_MAX);
    }, 20_000);
  });

  it("closes the response body when the caller aborts mid-stream", async () => {
    const controller = new AbortController();
    const chunk = new TextEncoder().encode("chunk");
    let closed = 0;
    const http: HttpClient = {
      async request(url): Promise<HttpResponse> {
        return {
          status: 200,
          headers: {},
          url,
          async text() {
            return "";
          },
          async json<T = unknown>(): Promise<T> {
            return null as T;
          },
          async bytes() {
            return chunk;
          },
          // A body that ignores the request signal: only closing the iterator can run its
          // `finally`, which is exactly what `for await`'s AsyncIteratorClose used to do.
          async *stream() {
            try {
              for (;;) {
                yield chunk;
                await new Promise((resolve) => setImmediate(resolve));
              }
            } finally {
              closed++;
            }
          },
        };
      },
    };
    const target = path.join(tmpDir, "aborted-midstream");
    await expect(
      downloadFile(http, {
        url: "https://abort-midstream/",
        target,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "download:progress") controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: MinecraftKitErrorCodes.LAUNCH_ABORTED });
    await flushTurns();
    expect(closed).toBe(1);
    expect(await leftoverTempFiles(tmpDir)).toEqual([]);
  });

  it("stops mirror fallback when the caller aborts", async () => {
    const http = new FakeHttpClient()
      .on("https://a/file", {
        error: () =>
          new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_ABORTED, "aborted", {
            context: { url: "https://a/file" },
          }),
      })
      .on("https://b/file", {
        body: new TextEncoder().encode("never-reached"),
      });
    const target = path.join(tmpDir, "x");
    await expect(
      downloadFile(http, {
        url: ["https://a/file", "https://b/file"],
        target,
      }),
    ).rejects.toMatchObject({ code: MinecraftKitErrorCodes.NETWORK_ABORTED });
    expect(http.requests.length).toBe(1);
  });
});
