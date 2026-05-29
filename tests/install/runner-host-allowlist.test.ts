import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DOWNLOAD_HOST_ALLOWLIST } from "../../src/constants/api";
import { createMemoryCache } from "../../src/http/cache";
import { runInstall } from "../../src/install/runner";
import type { HttpClient, HttpResponse } from "../../src/types/http";
import { type DownloadAction, InstallActionKinds, type InstallPlan } from "../../src/types/install";
import type { Spawner } from "../../src/types/spawner";
import { fakeTarget } from "../helpers/fake-kit";
import { sha1OfBytes } from "../helpers/hash";

const spawner: Spawner = {
  spawn() {
    throw new Error("spawner unused");
  },
};

const echoHttp: HttpClient = {
  async request(url): Promise<HttpResponse> {
    const body = new TextEncoder().encode(url);
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
  },
};

const makeAction = (tmpDir: string, url: string): DownloadAction => {
  const body = new TextEncoder().encode(url);
  return {
    kind: InstallActionKinds.DOWNLOAD_FILE,
    url,
    target: path.join(tmpDir, "artifact.bin"),
    expectedSha1: sha1OfBytes(body),
    expectedSize: body.byteLength,
    category: "library",
  };
};

const makePlan = (tmpDir: string, action: DownloadAction): InstallPlan => ({
  targetId: fakeTarget.id,
  directory: tmpDir,
  target: fakeTarget,
  actions: [action],
  totalActions: 1,
  totalBytes: action.expectedSize ?? 0,
});

describe("install runner — host allow-list threading", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-allow-"));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("forwards hostAllowList to downloads and blocks an off-host URL", async () => {
    const plan = makePlan(tmpDir, makeAction(tmpDir, "https://evil.example.com/lib.jar"));
    await expect(
      runInstall({
        plan,
        http: echoHttp,
        cache: createMemoryCache(),
        spawner,
        hostAllowList: DEFAULT_DOWNLOAD_HOST_ALLOWLIST,
      }),
    ).rejects.toThrow(/allow-list/);
  });
});
