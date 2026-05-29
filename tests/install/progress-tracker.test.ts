import { describe, expect, it } from "vitest";
import {
  type InstallProgressTracker,
  ProgressStages,
  createInstallProgressTracker,
} from "../../src/install/progress-tracker";
import {
  type DownloadAction,
  InstallActionKinds,
  InstallPhases,
  type InstallPlan,
} from "../../src/types/install";
import { VerificationKinds } from "../../src/types/verify";

const download = (
  target: string,
  category: DownloadAction["category"],
  size: number,
): DownloadAction => ({
  kind: InstallActionKinds.DOWNLOAD_FILE,
  url: `https://x/${target}`,
  target,
  expectedSize: size,
  category,
});

const planOf = (actions: readonly DownloadAction[]): Pick<InstallPlan, "actions"> => ({ actions });

const drive = (tracker: InstallProgressTracker): void => {
  tracker.onEvent({
    type: "install:phase-changed",
    phase: InstallPhases.INSTALLING_RUNTIME,
    previous: null,
  });
};

describe("createInstallProgressTracker", () => {
  it("buckets downloads into stable stages and tracks overall bytes", () => {
    const tracker = createInstallProgressTracker(
      planOf([
        download("/rt/a", "runtime-file", 100),
        download("/mc/a", "client-jar", 200),
        download("/mc/b", "library", 100),
        download("/ldr/a", "fabric-library", 100),
      ]),
      { throttleMs: 0 },
    );
    expect(tracker.snapshot().totalBytes).toBe(0);

    tracker.onEvent({
      type: "install:phase-changed",
      phase: InstallPhases.DOWNLOADING_CLIENT_JAR,
      previous: null,
    });
    expect(tracker.snapshot().stage).toBe(ProgressStages.MINECRAFT);
    expect(tracker.snapshot().totalBytes).toBe(300);

    tracker.onEvent({
      type: "download:completed",
      file: { url: "x", target: "/mc/a" },
      durationMs: 1,
      bytes: 200,
    });
    const snap = tracker.snapshot();
    expect(snap.bytesDownloaded).toBe(200);
    expect(snap.stagePercent).toBeCloseTo(200 / 3, 1);
  });

  it("counts skipped downloads as completed bytes", () => {
    const tracker = createInstallProgressTracker(planOf([download("/mc/a", "client-jar", 100)]), {
      throttleMs: 0,
    });
    drive(tracker);
    tracker.onEvent({
      type: "install:phase-changed",
      phase: InstallPhases.DOWNLOADING_CLIENT_JAR,
      previous: null,
    });
    tracker.onEvent({ type: "download:skipped", file: { url: "x", target: "/mc/a" } });
    expect(tracker.snapshot().bytesDownloaded).toBe(100);
    expect(tracker.snapshot().overallPercent).toBe(100);
  });

  it("tracks in-flight bytes and reconciles on completion", () => {
    const tracker = createInstallProgressTracker(planOf([download("/mc/a", "library", 1000)]), {
      throttleMs: 0,
    });
    tracker.onEvent({
      type: "install:phase-changed",
      phase: InstallPhases.DOWNLOADING_LIBRARIES,
      previous: null,
    });
    tracker.onEvent({
      type: "download:started",
      file: { url: "x", target: "/mc/a" },
      expectedSize: 1000,
    });
    tracker.onEvent({
      type: "download:progress",
      file: { url: "x", target: "/mc/a" },
      bytesDownloaded: 250,
      totalBytes: 1000,
    });
    expect(tracker.snapshot().bytesDownloaded).toBe(250);
    tracker.onEvent({
      type: "download:completed",
      file: { url: "x", target: "/mc/a" },
      durationMs: 1,
      bytes: 1000,
    });
    expect(tracker.snapshot().bytesDownloaded).toBe(1000);
  });

  it("uses aspect metadata for verification-only repair events", () => {
    const tracker = createInstallProgressTracker(planOf([]), { throttleMs: 0 });

    tracker.onEvent({
      type: "verify:file-checked",
      aspect: VerificationKinds.RUNTIME,
      file: {
        path: "/rt/bin/javaw.exe",
        category: "runtime-file",
        status: "missing",
      },
    });

    expect(tracker.snapshot()).toEqual(
      expect.objectContaining({
        stage: ProgressStages.RUNTIME,
        currentFile: "/rt/bin/javaw.exe",
      }),
    );
  });

  it("throttles snapshot pushes and emits a final 100% snapshot on finish()", async () => {
    const tracker = createInstallProgressTracker(planOf([download("/mc/a", "library", 100)]), {
      throttleMs: 30,
    });
    const seen: number[] = [];
    tracker.subscribe((s) => seen.push(s.overallPercent));
    expect(seen.length).toBe(1);

    tracker.onEvent({
      type: "install:phase-changed",
      phase: InstallPhases.DOWNLOADING_LIBRARIES,
      previous: null,
    });
    tracker.onEvent({
      type: "download:started",
      file: { url: "x", target: "/mc/a" },
      expectedSize: 100,
    });
    for (let i = 1; i <= 5; i++) {
      tracker.onEvent({
        type: "download:progress",
        file: { url: "x", target: "/mc/a" },
        bytesDownloaded: i * 10,
        totalBytes: 100,
      });
    }
    expect(seen.length).toBeLessThan(5);

    tracker.finish();
    expect(seen.at(-1)).toBe(100);
  });
});
