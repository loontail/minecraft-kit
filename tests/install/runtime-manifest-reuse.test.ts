import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryCache } from "../../src/http/cache";
import { runInstall } from "../../src/install/runner";
import {
  type DownloadAction,
  DownloadCategories,
  InstallActionKinds,
  type InstallPlan,
} from "../../src/types/install";
import type { Spawner } from "../../src/types/spawner";
import { FakeHttpClient } from "../helpers/fake-http";
import { fakeTarget } from "../helpers/fake-kit";
import { sha1OfBytes } from "../helpers/hash";

const spawner: Spawner = {
  spawn() {
    throw new Error("spawner unused");
  },
};

const RUNTIME_FILE_URL = "https://runtime/javaw";

describe("install runner — runtime manifest reuse", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-rt-"));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const runtimeFileAction = (): DownloadAction => {
    const body = new TextEncoder().encode("java");
    return {
      kind: InstallActionKinds.DOWNLOAD_FILE,
      url: RUNTIME_FILE_URL,
      target: path.join(tmpDir, "runtime", "java-runtime-gamma", "bin", "javaw.exe"),
      expectedSha1: sha1OfBytes(body),
      expectedSize: body.byteLength,
      category: DownloadCategories.RUNTIME_FILE,
    };
  };

  const planWith = (actions: readonly DownloadAction[], runtimeManifest?: object): InstallPlan => ({
    targetId: fakeTarget.id,
    directory: tmpDir,
    target: { ...fakeTarget, directory: tmpDir },
    actions,
    totalActions: actions.length,
    totalBytes: 0,
    ...(runtimeManifest !== undefined ? { runtimeManifest: runtimeManifest as never } : {}),
  });

  it("materializes runtime extras from the plan manifest without a second fetch", async () => {
    const http = new FakeHttpClient().on(RUNTIME_FILE_URL, { body: "java" });
    const report = await runInstall({
      plan: planWith([runtimeFileAction()], { files: {} }),
      http,
      cache: createMemoryCache(),
      spawner,
    });
    expect(report.targetId).toBe(fakeTarget.id);
    expect(http.requests.filter((r) => r.url === fakeTarget.runtime.manifestUrl).length).toBe(0);
  });

  it("falls back to fetching the manifest when the plan does not carry it", async () => {
    const http = new FakeHttpClient()
      .on(fakeTarget.runtime.manifestUrl, { body: JSON.stringify({ files: {} }) })
      .on(RUNTIME_FILE_URL, { body: "java" });
    await runInstall({
      plan: planWith([runtimeFileAction()]),
      http,
      cache: createMemoryCache(),
      spawner,
    });
    const manifestRequests = http.requests.filter(
      (r) => r.url === fakeTarget.runtime.manifestUrl,
    ).length;
    expect(manifestRequests).toBe(1);
  });

  // KIT-P8: a repair plan that touches no runtime file must not drag the runtime stage — that
  // stage fetched the manifest (fatal offline, after the repair's own downloads had landed) and
  // re-materialized every symlink on every repair.
  it("skips the runtime stage entirely when no runtime file is planned", async () => {
    const body = new TextEncoder().encode("asset");
    // Only the asset URL is scripted: FakeHttpClient throws "Unmocked URL" for anything else,
    // so a manifest fetch would fail the run outright.
    const http = new FakeHttpClient().on("https://assets/one", { body });
    const report = await runInstall({
      plan: planWith([
        {
          kind: InstallActionKinds.DOWNLOAD_FILE,
          url: "https://assets/one",
          target: path.join(tmpDir, "assets", "objects", "aa", "one"),
          expectedSha1: sha1OfBytes(body),
          expectedSize: body.byteLength,
          category: DownloadCategories.ASSET,
        },
      ]),
      http,
      cache: createMemoryCache(),
      spawner,
    });
    expect(report.actionsCompleted).toBe(1);
    expect(http.requests.map((r) => r.url)).toEqual(["https://assets/one"]);
  });
});
