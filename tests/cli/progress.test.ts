import { describe, expect, it } from "vitest";
import { ProgressRenderer, formatBytes, formatDuration } from "../../src/cli/progress";
import { createStubUi } from "../../src/cli/ui";

describe("formatBytes", () => {
  it("formats B / KB / MB / GB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
  });

  it("returns em-dash for invalid", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes, hours", () => {
    expect(formatDuration(500)).toBe("1s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(75_000)).toBe("1m15s");
    expect(formatDuration(3_725_000)).toBe("1h02m05s");
    expect(formatDuration(-1)).toBe("—");
  });
});

describe("ProgressRenderer", () => {
  it("updates the spinner in-place via spinner.message — never re-prints starts", () => {
    const ui = createStubUi();
    let now = 0;
    const renderer = new ProgressRenderer({
      ui,
      label: "Install",
      totalActions: 4,
      totalBytes: 1000,
      now: () => now,
      minRenderIntervalMs: 0,
    });
    const onEvent = renderer.attach();
    onEvent({ type: "install:phase-changed", phase: "downloading-libraries", previous: null });
    now = 100;
    onEvent({ type: "download:started", file: { url: "u", target: "/a" }, expectedSize: 500 });
    now = 200;
    onEvent({
      type: "download:completed",
      file: { url: "u", target: "/a" },
      durationMs: 100,
      bytes: 500,
    });

    const startCount = ui.calls.filter((c) => c.kind === "spinner-start").length;
    const messageCount = ui.calls.filter((c) => c.kind === "spinner-message").length;
    expect(startCount).toBe(1);
    expect(messageCount).toBeGreaterThan(0);
  });

  it("never includes ETA in any rendered line", () => {
    const ui = createStubUi();
    let now = 0;
    const renderer = new ProgressRenderer({
      ui,
      label: "Install",
      totalActions: 4,
      totalBytes: 1000,
      now: () => now,
      minRenderIntervalMs: 0,
    });
    const onEvent = renderer.attach();
    onEvent({ type: "install:phase-changed", phase: "downloading-libraries", previous: null });
    now = 100;
    onEvent({ type: "download:started", file: { url: "u", target: "/a" }, expectedSize: 500 });
    now = 200;
    onEvent({
      type: "download:progress",
      file: { url: "u", target: "/a" },
      bytesDownloaded: 250,
      totalBytes: 500,
    });
    now = 300;
    onEvent({
      type: "download:completed",
      file: { url: "u", target: "/a" },
      durationMs: 200,
      bytes: 250,
    });
    renderer.finish();

    for (const call of ui.calls) {
      expect(call.message.toLowerCase()).not.toContain("eta");
    }
  });

  it("renders phase / counters / aggregate speed / active count / percent", () => {
    const ui = createStubUi();
    let now = 0;
    const renderer = new ProgressRenderer({
      ui,
      label: "Install",
      totalActions: 4,
      totalBytes: 1000,
      now: () => now,
      minRenderIntervalMs: 0,
    });
    const onEvent = renderer.attach();
    onEvent({ type: "install:phase-changed", phase: "downloading-libraries", previous: null });
    now = 100;
    onEvent({ type: "download:started", file: { url: "u", target: "/a" }, expectedSize: 500 });
    now = 110;
    onEvent({ type: "download:started", file: { url: "v", target: "/b" }, expectedSize: 500 });
    now = 200;
    onEvent({
      type: "download:progress",
      file: { url: "u", target: "/a" },
      bytesDownloaded: 250,
      totalBytes: 500,
    });
    now = 300;
    onEvent({
      type: "download:completed",
      file: { url: "u", target: "/a" },
      durationMs: 200,
      bytes: 250,
    });

    const last =
      ui.calls
        .filter((c) => c.kind === "spinner-message")
        .map((c) => c.message)
        .at(-1) ?? "";
    expect(last).toContain("[libraries]");
    expect(last).not.toContain("downloading-libraries");
    expect(last).toContain("1/4");
    expect(last).toContain("/s");
    expect(last).toContain("active 1");
    expect(last).toContain("%");
    expect(last.toLowerCase()).not.toContain("eta");
  });

  it("does not spam the console when events fire faster than the throttle", () => {
    const ui = createStubUi();
    let now = 0;
    const renderer = new ProgressRenderer({
      ui,
      label: "Install",
      totalActions: 100,
      totalBytes: 1_000_000,
      now: () => now,
      minRenderIntervalMs: 250,
    });
    const onEvent = renderer.attach();
    for (let i = 0; i < 200; i++) {
      now += 5;
      onEvent({
        type: "download:progress",
        file: { url: "u", target: "/a" },
        bytesDownloaded: i * 100,
        totalBytes: 1_000_000,
      });
    }
    const renders = ui.calls.filter(
      (c) => c.kind === "spinner-start" || c.kind === "spinner-message",
    ).length;
    expect(renders).toBeLessThan(20);
  });

  it("dedupes consecutive identical lines", () => {
    const ui = createStubUi();
    const now = 0;
    const renderer = new ProgressRenderer({
      ui,
      label: "Install",
      totalActions: 1,
      totalBytes: 100,
      now: () => now,
      minRenderIntervalMs: 0,
    });
    const onEvent = renderer.attach();
    onEvent({ type: "install:phase-changed", phase: "downloading-libraries", previous: null });
    onEvent({ type: "install:phase-changed", phase: "downloading-libraries", previous: null });
    onEvent({ type: "install:phase-changed", phase: "downloading-libraries", previous: null });
    const messages = ui.calls.filter((c) => c.kind === "spinner-message");
    expect(messages.length).toBe(1);
  });

  it("emits a summary line on finish (no ETA in summary)", () => {
    const ui = createStubUi();
    let now = 0;
    const renderer = new ProgressRenderer({
      ui,
      label: "Install",
      totalActions: 1,
      totalBytes: 100,
      now: () => now,
      minRenderIntervalMs: 0,
    });
    const onEvent = renderer.attach();
    now = 100;
    onEvent({ type: "download:started", file: { url: "u", target: "/a" }, expectedSize: 100 });
    now = 200;
    onEvent({
      type: "download:completed",
      file: { url: "u", target: "/a" },
      durationMs: 100,
      bytes: 100,
    });
    now = 300;
    const summary = renderer.finish();
    expect(summary.filesDownloaded).toBe(1);
    expect(summary.bytesDownloaded).toBe(100);
    expect(summary.filesFailed).toBe(0);
    const stop = ui.calls.findLast((c) => c.kind === "spinner-stop");
    expect(stop?.message).toContain("Install done");
    expect(stop?.message).toContain("1 files");
    expect(stop?.message?.toLowerCase()).not.toContain("eta");
  });

  it("counts skipped files separately and includes them in summary", () => {
    const ui = createStubUi();
    const renderer = new ProgressRenderer({
      ui,
      label: "Update",
      totalActions: 2,
      totalBytes: 0,
      now: () => 0,
      minRenderIntervalMs: 0,
    });
    const onEvent = renderer.attach();
    onEvent({ type: "download:skipped", file: { url: "x", target: "/a" } });
    onEvent({ type: "download:skipped", file: { url: "y", target: "/b" } });
    const summary = renderer.finish();
    expect(summary.filesSkipped).toBe(2);
    expect(summary.filesDownloaded).toBe(2);
  });

  it("decrements active count and counts failure only when willRetry is false", () => {
    const ui = createStubUi();
    const renderer = new ProgressRenderer({
      ui,
      label: "Install",
      totalActions: 1,
      totalBytes: 100,
      now: () => 0,
      minRenderIntervalMs: 0,
    });
    const onEvent = renderer.attach();
    onEvent({ type: "download:started", file: { url: "u", target: "/a" }, expectedSize: 100 });
    onEvent({
      type: "download:failed",
      file: { url: "u", target: "/a" },
      error: new Error("transient"),
      willRetry: true,
    });
    expect(renderer.summary().filesFailed).toBe(0);
    onEvent({
      type: "download:failed",
      file: { url: "u", target: "/a" },
      error: new Error("fatal"),
      willRetry: false,
    });
    expect(renderer.summary().filesFailed).toBe(1);
    const last =
      ui.calls
        .filter((c) => c.kind === "spinner-message")
        .map((c) => c.message)
        .at(-1) ?? "";
    expect(last).toContain("active 0");
  });

  it("fail() stops the spinner with an error message", () => {
    const ui = createStubUi();
    const renderer = new ProgressRenderer({
      ui,
      label: "Install",
      now: () => 0,
      minRenderIntervalMs: 0,
    });
    renderer.attach();
    renderer.fail("something broke");
    const stop = ui.calls.findLast((c) => c.kind === "spinner-stop");
    expect(stop?.message).toContain("failed");
    expect(stop?.message).toContain("something broke");
  });
});
