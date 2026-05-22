import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DOWNLOAD_CONCURRENCY } from "../../src/constants/defaults";
import { createMemoryCache } from "../../src/http/cache";
import { runInstall } from "../../src/install/runner";
import type { HttpClient, HttpResponse } from "../../src/types/http";
import { type DownloadAction, InstallActionKinds, type InstallPlan } from "../../src/types/install";
import type { Spawner } from "../../src/types/spawner";
import { fakeTarget } from "../helpers/fake-kit";
import { sha1OfBytes } from "../helpers/hash";

describe("install runner concurrency", () => {
  it("defaults DOWNLOAD_CONCURRENCY to 32", () => {
    expect(DOWNLOAD_CONCURRENCY).toBe(32);
  });
});

const waitFor = (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("waitFor timed out"));
        return;
      }
      setImmediate(tick);
    };
    tick();
  });
};

describe("install runner worker-pool", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-conc-"));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("runs up to N downloads concurrently and starts the next as soon as one finishes", async () => {
    const fileCount = 16;
    const concurrency = 4;
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];

    const RUNTIME_MANIFEST_URL = "https://rm/";

    const http: HttpClient = {
      async request(url): Promise<HttpResponse> {
        if (url === RUNTIME_MANIFEST_URL) {
          return respondWithEmptyRuntimeManifest(url);
        }
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => release.push(resolve));
        inFlight--;
        const body = new TextEncoder().encode(url);
        return makeResponse(url, body);
      },
    };

    const actions: DownloadAction[] = Array.from({ length: fileCount }, (_, i) => {
      const url = `https://x/${i}`;
      const body = new TextEncoder().encode(url);
      return {
        kind: InstallActionKinds.DOWNLOAD_FILE,
        url,
        target: path.join(tmpDir, `file-${i}.bin`),
        expectedSha1: sha1OfBytes(body),
        expectedSize: body.byteLength,
        category: "library",
      };
    });
    const plan: InstallPlan = {
      targetId: fakeTarget.id,
      directory: tmpDir,
      target: fakeTarget,
      actions,
      totalActions: actions.length,
      totalBytes: actions.reduce((sum, a) => sum + (a.expectedSize ?? 0), 0),
    };
    const spawner: Spawner = {
      spawn() {
        throw new Error("spawner unused");
      },
    };

    const runPromise = runInstall({
      plan,
      http,
      cache: createMemoryCache(),
      spawner,
      concurrency,
    });

    await assertPoolFillsToConcurrency({
      concurrency,
      waitForFill: () => waitFor(() => inFlight >= concurrency),
      readInFlight: () => inFlight,
      readPeak: () => peak,
    });

    await drainOneAtATimeAndRequireRefill({
      concurrency,
      fileCount,
      release,
      waitFor,
    });

    const report = await runPromise;
    expect(report.actionsCompleted).toBeGreaterThanOrEqual(fileCount);
    expect(peak).toBe(concurrency);
  }, 10_000);
});

const respondWithEmptyRuntimeManifest = (url: string): HttpResponse => {
  const body = new TextEncoder().encode('{"files":{}}');
  return makeResponse(url, body);
};

const assertPoolFillsToConcurrency = async (input: {
  readonly concurrency: number;
  readonly waitForFill: () => Promise<void>;
  readonly readInFlight: () => number;
  readonly readPeak: () => number;
}): Promise<void> => {
  await input.waitForFill();
  expect(input.readInFlight()).toBe(input.concurrency);
  expect(input.readPeak()).toBe(input.concurrency);
};

/**
 * Release one in-flight slot at a time and confirm the worker pool immediately re-fills.
 * Verifies there is no batch barrier — a finished slot triggers the next dispatch.
 */
const drainOneAtATimeAndRequireRefill = async (input: {
  readonly concurrency: number;
  readonly fileCount: number;
  readonly release: (() => void)[];
  readonly waitFor: (predicate: () => boolean) => Promise<void>;
}): Promise<void> => {
  let remaining = input.fileCount;
  while (remaining > 0) {
    const expected = Math.min(input.concurrency, remaining);
    await input.waitFor(() => input.release.length === expected);
    const next = input.release.shift();
    next?.();
    remaining--;
  }
};

const makeResponse = (url: string, body: Uint8Array): HttpResponse => {
  return {
    status: 200,
    headers: { "content-length": String(body.byteLength) },
    url,
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
};
