import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { targetPaths } from "../../src/core/paths";
import { PauseController } from "../../src/core/pause-controller";
import { createMemoryCache } from "../../src/http/cache";
import { runRepair } from "../../src/repair/runner";
import type { ProgressEvent } from "../../src/types/events";
import {
  type DownloadAction,
  DownloadCategories,
  InstallActionKinds,
} from "../../src/types/install";
import type { RepairPlan } from "../../src/types/repair";
import { FakeHttpClient } from "../helpers/fake-http";
import { FakeSpawner } from "../helpers/fake-spawner";
import { buildForgeTarget } from "../helpers/forge-fixture";
import { sha1OfBytes } from "../helpers/hash";

const libraryAction = (tmpDir: string, name: string): DownloadAction => {
  const url = `https://forge/lib/${name}`;
  const body = new TextEncoder().encode(url);
  return {
    kind: InstallActionKinds.DOWNLOAD_FILE,
    url,
    target: path.join(targetPaths.librariesDir(tmpDir), `${name}.jar`),
    expectedSha1: sha1OfBytes(body),
    expectedSize: body.byteLength,
    category: DownloadCategories.FORGE_LIBRARY,
  };
};

// KIT-P13: the repair surface accepted neither pauseController nor actionCategories even though
// the runner underneath supports both, and RepairReport dropped the actionsSkipped the runner
// already computed — which is the only way to read a Forge repair report, because its defensive
// sweep re-emits every forge library counting on skip-on-correct.
describe("runRepair — install-parity run options", () => {
  let tmpDir: string;
  let plan: RepairPlan;
  let http: FakeHttpClient;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-repair-opts-"));
    const actions = [
      libraryAction(tmpDir, "a"),
      libraryAction(tmpDir, "b"),
      libraryAction(tmpDir, "c"),
    ];
    plan = {
      targetId: "forge-target",
      directory: tmpDir,
      target: buildForgeTarget(tmpDir),
      actions,
      totalActions: actions.length,
      totalBytes: 0,
    };
    http = new FakeHttpClient();
    for (const action of actions) {
      const url = String(action.url);
      http.on(url, { body: new TextEncoder().encode(url) });
    }
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const run = (options: Partial<Parameters<typeof runRepair>[0]> = {}) => {
    const events: ProgressEvent[] = [];
    return {
      events,
      report: runRepair({
        plan,
        http,
        cache: createMemoryCache(),
        spawner: new FakeSpawner(),
        onEvent: (event) => events.push(event),
        ...options,
      }),
    };
  };

  it("holds the repair at the pause checkpoint and finishes after resume()", async () => {
    const pauseController = new PauseController();
    pauseController.pause();
    const { events, report } = run({ pauseController });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(events.filter((e) => e.type === "download:started")).toHaveLength(0);

    pauseController.resume();
    const result = await report;
    expect(result.actionsCompleted).toBe(3);
    expect(events.filter((e) => e.type === "download:started")).toHaveLength(3);
  });

  it("reports actionsSkipped for files that were already correct", async () => {
    await run().report;
    const second = await run().report;

    expect(second.actionsCompleted).toBe(3);
    expect(second.actionsSkipped).toBe(3);
  });

  it("honours actionCategories on the repair path", async () => {
    const { report } = run({ actionCategories: new Set([DownloadCategories.ASSET]) });
    const result = await report;
    expect(result.actionsCompleted).toBe(0);
    expect(http.requests).toEqual([]);
  });
});
