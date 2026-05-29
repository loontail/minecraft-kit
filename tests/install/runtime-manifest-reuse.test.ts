import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryCache } from "../../src/http/cache";
import { runInstall } from "../../src/install/runner";
import type { InstallPlan } from "../../src/types/install";
import type { Spawner } from "../../src/types/spawner";
import { FakeHttpClient } from "../helpers/fake-http";
import { fakeTarget } from "../helpers/fake-kit";

const spawner: Spawner = {
  spawn() {
    throw new Error("spawner unused");
  },
};

describe("install runner — runtime manifest reuse", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-rt-"));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("materializes runtime extras from the plan manifest without a second fetch", async () => {
    const http = new FakeHttpClient();
    const plan: InstallPlan = {
      targetId: fakeTarget.id,
      directory: tmpDir,
      target: { ...fakeTarget, directory: tmpDir },
      actions: [],
      totalActions: 0,
      totalBytes: 0,
      runtimeManifest: { files: {} },
    };
    const report = await runInstall({ plan, http, cache: createMemoryCache(), spawner });
    expect(report.targetId).toBe(fakeTarget.id);
    expect(http.requests.length).toBe(0);
  });

  it("falls back to fetching the manifest when the plan does not carry it", async () => {
    const http = new FakeHttpClient().on(fakeTarget.runtime.manifestUrl, {
      body: JSON.stringify({ files: {} }),
    });
    const plan: InstallPlan = {
      targetId: fakeTarget.id,
      directory: tmpDir,
      target: { ...fakeTarget, directory: tmpDir },
      actions: [],
      totalActions: 0,
      totalBytes: 0,
    };
    await runInstall({ plan, http, cache: createMemoryCache(), spawner });
    const manifestRequests = http.requests.filter(
      (r) => r.url === fakeTarget.runtime.manifestUrl,
    ).length;
    expect(manifestRequests).toBe(1);
  });
});
