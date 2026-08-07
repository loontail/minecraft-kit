import { describe, expect, it } from "vitest";
import {
  createInstallProgressTracker,
  type InstallProgressTracker,
  ProgressStages,
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

  // KIT-P6: `bytesDownloaded` used to be install-wide while `totalBytes` was the current stage's
  // total, so `bytesDownloaded / totalBytes` exceeded 100% on any run with more than one stage.
  it("keeps each byte pair on one denominator across stages", () => {
    const tracker = createInstallProgressTracker(
      planOf([download("/rt/a", "runtime-file", 100), download("/mc/a", "client-jar", 200)]),
      { throttleMs: 0 },
    );
    drive(tracker);
    tracker.onEvent({
      type: "download:completed",
      file: { url: "x", target: "/rt/a" },
      durationMs: 1,
      bytes: 100,
    });
    tracker.onEvent({
      type: "install:phase-changed",
      phase: InstallPhases.DOWNLOADING_CLIENT_JAR,
      previous: InstallPhases.INSTALLING_RUNTIME,
    });
    tracker.onEvent({
      type: "download:started",
      file: { url: "x", target: "/mc/a" },
      expectedSize: 200,
    });
    tracker.onEvent({
      type: "download:progress",
      file: { url: "x", target: "/mc/a" },
      bytesDownloaded: 50,
      totalBytes: 200,
    });

    const snap = tracker.snapshot();
    expect(snap.bytesDownloaded).toBe(50);
    expect(snap.totalBytes).toBe(200);
    expect(snap.overallBytesDownloaded).toBe(150);
    expect(snap.overallTotalBytes).toBe(300);
  });

  // A retry re-streams the file from byte 0, and download.ts emits a fresh `download:started` per
  // attempt, so the abandoned attempt's bytes must be given back — otherwise they are counted
  // forever and the numerator overruns the denominator.
  it("does not double-count bytes when an attempt restarts", () => {
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
      bytesDownloaded: 600,
      totalBytes: 1000,
    });
    tracker.onEvent({
      type: "download:started",
      file: { url: "x", target: "/mc/a" },
      expectedSize: 1000,
    });
    expect(tracker.snapshot().bytesDownloaded).toBe(0);

    tracker.onEvent({
      type: "download:progress",
      file: { url: "x", target: "/mc/a" },
      bytesDownloaded: 1000,
      totalBytes: 1000,
    });
    tracker.onEvent({
      type: "download:completed",
      file: { url: "x", target: "/mc/a" },
      durationMs: 1,
      bytes: 1000,
    });

    const snap = tracker.snapshot();
    expect(snap.bytesDownloaded).toBe(1000);
    expect(snap.totalBytes).toBe(1000);
    expect(snap.stagePercent).toBe(100);
    expect(snap.overallBytesDownloaded).toBe(1000);
  });

  it("releases in-flight bytes when a download fails", () => {
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
      bytesDownloaded: 600,
      totalBytes: 1000,
    });
    tracker.onEvent({
      type: "download:failed",
      file: { url: "x", target: "/mc/a" },
      error: new Error("stalled"),
      willRetry: false,
    });

    expect(tracker.snapshot().bytesDownloaded).toBe(0);
    expect(tracker.snapshot().overallBytesDownloaded).toBe(0);
  });

  it("reports both pairs complete after finish() on a run that downloaded everything", () => {
    const tracker = createInstallProgressTracker(
      planOf([download("/rt/a", "runtime-file", 100), download("/mc/a", "client-jar", 200)]),
      { throttleMs: 0 },
    );

    tracker.onEvent({
      type: "download:completed",
      file: { url: "x", target: "/rt/a" },
      durationMs: 1,
      bytes: 100,
    });
    tracker.onEvent({
      type: "download:completed",
      file: { url: "x", target: "/mc/a" },
      durationMs: 1,
      bytes: 200,
    });
    tracker.finish();

    const snap = tracker.snapshot();
    expect(snap.stage).toBe(ProgressStages.FINALIZE);
    expect(snap.bytesDownloaded).toBe(300);
    expect(snap.totalBytes).toBe(300);
    expect(snap.stagePercent).toBe(100);
    expect(snap.overallBytesDownloaded).toBe(300);
    expect(snap.overallTotalBytes).toBe(300);
    expect(snap.overallPercent).toBe(100);
  });

  // finish() also runs on failure and on cancel. Reporting the PLAN total there turned a
  // run that died early into a final "everything downloaded" line, with the temp file
  // already unlinked and nothing on disk.
  it("does not claim the plan was downloaded when the run failed part-way", () => {
    const tracker = createInstallProgressTracker(planOf([download("/mc/a", "client-jar", 1000)]), {
      throttleMs: 0,
    });

    tracker.onEvent({
      type: "download:started",
      file: { url: "x", target: "/mc/a" },
      expectedSize: 1000,
    });
    tracker.onEvent({
      type: "download:progress",
      file: { url: "x", target: "/mc/a" },
      bytesDownloaded: 40,
      totalBytes: 1000,
    });
    tracker.onEvent({
      type: "download:failed",
      file: { url: "x", target: "/mc/a" },
      error: new Error("every mirror exhausted"),
      willRetry: false,
    });
    tracker.finish();

    const snap = tracker.snapshot();
    expect(snap.overallTotalBytes).toBe(1000);
    expect(snap.overallBytesDownloaded).toBe(0);
    expect(snap.overallPercent).toBe(0);
    expect(snap.totalBytes).toBe(0);
  });

  it("reports 100% after finish() even when the plan downloads nothing", () => {
    const tracker = createInstallProgressTracker(planOf([]), { throttleMs: 0 });
    const seen: number[] = [];
    tracker.subscribe((s) => seen.push(s.stagePercent));

    tracker.finish();

    expect(seen.at(-1)).toBe(100);
    expect(tracker.snapshot().overallPercent).toBe(100);
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

    // The download has to actually finish for the final snapshot to read 100%: finish()
    // reports the bytes the run moved, not the plan, so that a failed or cancelled run
    // does not end on a full bar.
    tracker.onEvent({
      type: "download:completed",
      file: { url: "x", target: "/mc/a" },
      durationMs: 1,
      bytes: 100,
    });

    tracker.finish();
    expect(seen.at(-1)).toBe(100);
  });
});
