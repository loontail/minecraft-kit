import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { targetPaths } from "../../src/core/paths";
import { createMemoryCache } from "../../src/http/cache";
import { runInstall } from "../../src/install/runner";
import type { ProgressEvent } from "../../src/types/events";
import {
  type DownloadAction,
  DownloadCategories,
  type ExtractNativeAction,
  type InstallAction,
  InstallActionKinds,
  InstallPhases,
  type InstallPlan,
  type RunForgeProcessorAction,
} from "../../src/types/install";
import { FakeHttpClient } from "../helpers/fake-http";
import { FakeSpawner } from "../helpers/fake-spawner";
import { buildForgeTarget } from "../helpers/forge-fixture";
import { sha1OfBytes } from "../helpers/hash";
import { writeFixtureZip } from "../helpers/zip";

const bodyFor = (url: string): Uint8Array => new TextEncoder().encode(url);

const download = (
  tmpDir: string,
  category: DownloadAction["category"],
  name: string,
): DownloadAction => {
  const url = `https://x/${category}/${name}`;
  const body = bodyFor(url);
  return {
    kind: InstallActionKinds.DOWNLOAD_FILE,
    url,
    target: path.join(tmpDir, `${category}-${name}.bin`),
    expectedSha1: sha1OfBytes(body),
    expectedSize: body.byteLength,
    category,
  };
};

// KIT-P10: `actionCategories` documented that dependent post-download steps are skipped too, but
// only the download bucket was ever filtered — an "assets only" run still spawned every Forge
// processor, extracted natives, and fetched the runtime manifest.
describe("install runner — actionCategories gates dependent stages", () => {
  let tmpDir: string;
  let nativeJar: string;
  let plan: InstallPlan;
  let http: FakeHttpClient;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-categories-"));
    nativeJar = path.join(tmpDir, "native.jar");
    // Doubles as the processor JAR: `runProcessor` reads Main-Class from `classpath[0]`, and the
    // natives extraction excludes `META-INF/` so the manifest never lands in the natives dir.
    await writeFixtureZip(nativeJar, [
      { name: "META-INF/MANIFEST.MF", content: "Main-Class: com.example.Noop\n" },
      { name: "lib/native.dll", content: "dll" },
    ]);

    const target = buildForgeTarget(tmpDir);
    const runtimeFile = download(tmpDir, DownloadCategories.RUNTIME_FILE, "javaw");
    const asset = download(tmpDir, DownloadCategories.ASSET, "one");
    const assetIndex = download(tmpDir, DownloadCategories.ASSET_INDEX, "5");
    const library = download(tmpDir, DownloadCategories.LIBRARY, "lib");
    const forgeLibrary = download(tmpDir, DownloadCategories.FORGE_LIBRARY, "forge");
    const native: ExtractNativeAction = {
      kind: InstallActionKinds.EXTRACT_NATIVE,
      source: nativeJar,
      destination: path.join(tmpDir, "natives"),
      exclude: ["META-INF/"],
    };
    const processor: RunForgeProcessorAction = {
      kind: InstallActionKinds.RUN_FORGE_PROCESSOR,
      index: 0,
      classpath: [nativeJar],
      args: ["--task", "noop"],
      outputs: {},
    };
    const actions: InstallAction[] = [
      runtimeFile,
      asset,
      assetIndex,
      library,
      forgeLibrary,
      native,
      processor,
      {
        kind: InstallActionKinds.WRITE_VERSION_JSON,
        path: targetPaths.versionJson(tmpDir, "1.20.1"),
        content: "{}\n",
      },
    ];
    plan = {
      targetId: target.id,
      directory: tmpDir,
      target,
      actions,
      totalActions: actions.length,
      totalBytes: 0,
    };
    http = new FakeHttpClient();
    for (const action of [runtimeFile, asset, assetIndex, library, forgeLibrary]) {
      const url = String(action.url);
      http.on(url, { body: bodyFor(url) });
    }
    http.on("https://runtime-manifest/", { body: JSON.stringify({ files: {} }) });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const run = (actionCategories?: ReadonlySet<DownloadAction["category"]>) => {
    const spawner = new FakeSpawner();
    const events: ProgressEvent[] = [];
    return {
      spawner,
      events,
      report: runInstall({
        plan,
        http,
        cache: createMemoryCache(),
        spawner,
        onEvent: (event) => events.push(event),
        ...(actionCategories !== undefined ? { actionCategories } : {}),
      }),
    };
  };

  it("an assets-only run touches nothing but assets", async () => {
    const { spawner, events, report } = run(
      new Set([DownloadCategories.ASSET_INDEX, DownloadCategories.ASSET]),
    );
    await report;

    expect(spawner.invocations).toEqual([]);
    expect(http.requests.map((r) => r.url).sort()).toEqual([
      "https://x/asset-index/5",
      "https://x/asset/one",
    ]);
    expect(
      events.some(
        (e) => e.type === "install:phase-changed" && e.phase === InstallPhases.EXTRACTING_NATIVES,
      ),
    ).toBe(false);
    await expect(fs.stat(path.join(tmpDir, "natives"))).rejects.toThrow();
    // Writes are unconditional on purpose: they are cheap, idempotent, and keep a partial run's
    // tree coherent.
    expect(await fs.readFile(targetPaths.versionJson(tmpDir, "1.20.1"), "utf8")).toBe("{}\n");
  });

  it("including FORGE_LIBRARY runs the processors", async () => {
    const { spawner, report } = run(new Set([DownloadCategories.FORGE_LIBRARY]));
    await report;
    expect(spawner.invocations).toHaveLength(1);
  });

  it("including LIBRARY extracts natives", async () => {
    const { events, report } = run(new Set([DownloadCategories.LIBRARY]));
    await report;
    expect(
      events.some(
        (e) => e.type === "install:phase-changed" && e.phase === InstallPhases.EXTRACTING_NATIVES,
      ),
    ).toBe(true);
    expect(await fs.readFile(path.join(tmpDir, "natives", "lib", "native.dll"), "utf8")).toBe(
      "dll",
    );
  });

  it("including RUNTIME_FILE runs the runtime stage", async () => {
    const { report } = run(new Set([DownloadCategories.RUNTIME_FILE]));
    await report;
    expect(http.requests.some((r) => r.url === "https://runtime-manifest/")).toBe(true);
  });

  it("an empty category set is a total no-op that still completes", async () => {
    const { spawner, events, report } = run(new Set());
    const result = await report;

    expect(spawner.invocations).toEqual([]);
    expect(http.requests).toEqual([]);
    expect(result.bytesDownloaded).toBe(0);
    expect(events.at(-1)).toMatchObject({
      type: "install:phase-changed",
      phase: InstallPhases.COMPLETED,
    });
  });

  it("an unfiltered run does everything", async () => {
    const { spawner, report } = run();
    await report;
    expect(spawner.invocations).toHaveLength(1);
    expect(http.requests.some((r) => r.url === "https://runtime-manifest/")).toBe(true);
    expect(await fs.readFile(path.join(tmpDir, "natives", "lib", "native.dll"), "utf8")).toBe(
      "dll",
    );
  });
});
