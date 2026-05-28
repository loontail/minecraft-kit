import { EventTypes, type InstallPhase, type ProgressEvent, type ProgressListener } from "../index";
import type { Ui, UiSpinner } from "./ui";

type PhaseLabel = InstallPhase | "idle";

/**
 * Aggregated metrics produced by {@link ProgressRenderer.summary}.
 *
 * @internal
 */
export type ProgressSummary = {
  readonly filesDownloaded: number;
  readonly filesSkipped: number;
  readonly filesFailed: number;
  readonly bytesDownloaded: number;
  readonly durationMs: number;
  readonly avgSpeedBps: number;
};

/**
 * Inputs to {@link ProgressRenderer}.
 *
 * @internal
 */
export type ProgressRendererInput = {
  readonly ui: Ui;
  /** Optional plan totals (used as the denominator for files / bytes when known). */
  readonly totalActions?: number;
  readonly totalBytes?: number;
  /** Label shown next to the progress bar, e.g. `"Install"` / `"Repair"` / `"Update"`. */
  readonly label: string;
  /** Wallclock now() — overridable for tests. */
  readonly now?: () => number;
  /** Throttle minimum between renders, in milliseconds. */
  readonly minRenderIntervalMs?: number;
  /** Override terminal width (defaults to `process.stdout.columns`). */
  readonly columns?: () => number;
};

const DEFAULT_RENDER_INTERVAL_MS = 250;
const SPEED_WINDOW_MS = 5_000;
const BAR_WIDTH = 12;
const SAFETY_MARGIN = 1;

/**
 * Throttled, single-line progress renderer. Listens to library {@link ProgressEvent}s and
 * updates a Ui spinner with phase, file counter, byte counter, aggregate speed, active
 * download count, and a textual progress bar. Updates land **in-place** through
 * {@link UiSpinner.message} — there is no per-event newline. Aggregate bytes are computed
 * as `completedBytes + sum(activeBytes)` so retries cannot over-count.
 *
 * @internal
 */
export class ProgressRenderer {
  private readonly ui: Ui;
  private readonly label: string;
  private readonly totalActions: number | undefined;
  private readonly totalBytes: number | undefined;
  private readonly now: () => number;
  private readonly minRenderIntervalMs: number;
  private readonly columnsFn: () => number;
  private readonly speedSamples: { readonly ts: number; readonly bytes: number }[] = [];
  private readonly spinner: UiSpinner;
  /** Authoritative bytes for files that have completed. */
  private completedBytes = 0;
  /** Latest progress bytes for files that are currently downloading. */
  private readonly activeBytes = new Map<string, number>();
  /** Files for which `download:started` fired but `download:completed/failed` has not. */
  private readonly activeTargets = new Set<string>();
  private startedAt: number;
  private lastRenderAt = 0;
  private lastRenderedLine: string | null = null;
  private currentPhase: PhaseLabel = "idle";
  private filesCompleted = 0;
  private filesSkipped = 0;
  private filesFailed = 0;
  private active = false;

  constructor(input: ProgressRendererInput) {
    this.ui = input.ui;
    this.label = input.label;
    if (input.totalActions !== undefined) this.totalActions = input.totalActions;
    if (input.totalBytes !== undefined) this.totalBytes = input.totalBytes;
    this.now = input.now ?? (() => Date.now());
    this.minRenderIntervalMs = input.minRenderIntervalMs ?? DEFAULT_RENDER_INTERVAL_MS;
    this.columnsFn =
      input.columns ??
      (() => (typeof process.stdout.columns === "number" ? process.stdout.columns : 0));
    this.spinner = this.ui.spinner();
    this.startedAt = this.now();
  }

  /** Start the spinner and return a listener function suitable for `kit.install.run({ onEvent })`. */
  attach(): ProgressListener {
    this.active = true;
    this.startedAt = this.now();
    this.lastRenderAt = 0;
    this.lastRenderedLine = null;
    this.spinner.start(`${this.label}…`);
    return (event) => this.handle(event);
  }

  /** Stop the spinner with a final summary line and return the metrics. */
  finish(): ProgressSummary {
    if (!this.active) return this.summary();
    this.active = false;
    const summary = this.summary();
    this.spinner.stop(this.summaryLine(summary));
    return summary;
  }

  /** Stop with a failure message instead of the summary. */
  fail(message: string): void {
    if (!this.active) return;
    this.active = false;
    this.spinner.stop(`${this.label} failed: ${message}`);
  }

  /** Snapshot of current metrics. */
  summary(): ProgressSummary {
    const durationMs = Math.max(0, this.now() - this.startedAt);
    const bytes = this.bytesDownloadedNow();
    const avgSpeedBps = durationMs > 0 ? (bytes * 1000) / durationMs : 0;
    return {
      filesDownloaded: this.filesCompleted,
      filesSkipped: this.filesSkipped,
      filesFailed: this.filesFailed,
      bytesDownloaded: bytes,
      durationMs,
      avgSpeedBps,
    };
  }

  /** Handle one event. Re-rendering is throttled to {@link minRenderIntervalMs}. */
  private handle(event: ProgressEvent): void {
    let forceRender = false;
    switch (event.type) {
      case EventTypes.INSTALL_PHASE_CHANGED:
        this.currentPhase = event.phase;
        forceRender = true;
        break;
      case EventTypes.DOWNLOAD_STARTED:
        this.activeTargets.add(event.file.target);
        this.activeBytes.set(event.file.target, 0);
        forceRender = true;
        break;
      case EventTypes.DOWNLOAD_PROGRESS: {
        const previous = this.activeBytes.get(event.file.target) ?? 0;
        if (event.bytesDownloaded > previous) {
          const ts = this.now();
          this.speedSamples.push({ ts, bytes: event.bytesDownloaded - previous });
          const cutoff = ts - SPEED_WINDOW_MS;
          while (this.speedSamples[0] !== undefined && this.speedSamples[0].ts < cutoff) {
            this.speedSamples.shift();
          }
        }
        this.activeBytes.set(event.file.target, event.bytesDownloaded);
        break;
      }
      case EventTypes.DOWNLOAD_COMPLETED:
        this.filesCompleted++;
        this.completedBytes += event.bytes;
        this.activeTargets.delete(event.file.target);
        this.activeBytes.delete(event.file.target);
        forceRender = true;
        break;
      case EventTypes.DOWNLOAD_SKIPPED:
        this.filesSkipped++;
        this.filesCompleted++;
        forceRender = true;
        break;
      case EventTypes.DOWNLOAD_FAILED:
        if (event.willRetry) {
          this.resetActiveBytesForRetry(event.file.target);
        } else {
          this.filesFailed++;
          this.activeTargets.delete(event.file.target);
          this.activeBytes.delete(event.file.target);
        }
        forceRender = true;
        break;
      case EventTypes.ARCHIVE_EXTRACTED:
      case EventTypes.FORGE_PROCESSOR_STARTED:
      case EventTypes.FORGE_PROCESSOR_COMPLETED:
        forceRender = true;
        break;
      default:
        break;
    }
    this.maybeRender(forceRender);
  }

  /**
   * Reset the per-file byte counter when a download fails but will be retried.
   * Retries start over from byte 0 (no HTTP Range resumption), so leaving the
   * old counter in place would double-count once the new attempt streams data.
   */
  private resetActiveBytesForRetry(target: string): void {
    this.activeBytes.set(target, 0);
  }

  private maybeRender(force: boolean): void {
    if (!this.active) return;
    const ts = this.now();
    if (!force && ts - this.lastRenderAt < this.minRenderIntervalMs) return;
    const line = this.formatLine();
    if (line === this.lastRenderedLine) return;
    this.lastRenderAt = ts;
    this.lastRenderedLine = line;
    this.spinner.message(line);
  }

  private bytesDownloadedNow(): number {
    let sum = this.completedBytes;
    for (const v of this.activeBytes.values()) sum += v;
    return sum;
  }

  private formatLine(): string {
    const phase = shortPhase(this.currentPhase);
    const bytes = this.bytesDownloadedNow();
    const speed = this.computeSpeedBps();
    const active = this.activeTargets.size;
    const ratio = this.computeRatio();
    const fileCounter =
      this.totalActions !== undefined
        ? `${this.filesCompleted}/${this.totalActions}`
        : `${this.filesCompleted}`;
    const segments: string[] = [`[${phase}]`, fileCounter, formatBytes(bytes)];
    if (speed > 0) segments.push(`${formatBytes(speed)}/s`);
    segments.push(`active ${active}`);
    if (ratio !== null) segments.push(`${this.formatBar(ratio)} ${(ratio * 100).toFixed(0)}%`);
    const line = segments.join(" · ");
    return clipToColumns(line, this.columnsFn());
  }

  private formatBar(ratio: number): string {
    const filled = Math.round(ratio * BAR_WIDTH);
    return `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}`;
  }

  private computeRatio(): number | null {
    if (this.totalBytes !== undefined && this.totalBytes > 0) {
      return Math.min(1, this.bytesDownloadedNow() / this.totalBytes);
    }
    if (this.totalActions !== undefined && this.totalActions > 0) {
      return Math.min(1, this.filesCompleted / this.totalActions);
    }
    return null;
  }

  private computeSpeedBps(): number {
    const oldest = this.speedSamples[0];
    if (oldest === undefined) return 0;
    const elapsed = Math.max(1, this.now() - oldest.ts);
    const bytes = this.speedSamples.reduce((sum, sample) => sum + sample.bytes, 0);
    return (bytes * 1000) / elapsed;
  }

  private summaryLine(summary: ProgressSummary): string {
    const total = this.totalActions !== undefined ? `/${this.totalActions}` : "";
    const parts: string[] = [`${this.label} done`, `${summary.filesDownloaded}${total} files`];
    if (summary.filesSkipped > 0) parts.push(`${summary.filesSkipped} skipped`);
    if (summary.filesFailed > 0) parts.push(`${summary.filesFailed} failed`);
    parts.push(`${formatBytes(summary.bytesDownloaded)}`);
    if (summary.avgSpeedBps > 0) parts.push(`avg ${formatBytes(summary.avgSpeedBps)}/s`);
    parts.push(`in ${formatDuration(summary.durationMs)}`);
    return clipToColumns(parts.join(" · "), this.columnsFn());
  }
}

/** Drop the verbose `downloading-` / `installing-` / etc. prefix to keep lines compact. */
const shortPhase = (phase: string): string => {
  if (phase === "idle") return "starting";
  for (const prefix of [
    "downloading-",
    "installing-",
    "extracting-",
    "repairing-",
    "running-",
    "writing-",
  ]) {
    if (phase.startsWith(prefix)) return phase.slice(prefix.length);
  }
  return phase;
};

/**
 * Clip a single-line message to the available terminal width. Anything wider than the
 * column count would wrap onto a physical second line, which makes the next `\r\x1b[2K`
 * leave the original wrapped tail visible — the very bug that made the previous progress
 * renderer look like it was spamming new lines.
 */
const clipToColumns = (line: string, cols: number): string => {
  if (cols <= 0) return line;
  const limit = cols - SAFETY_MARGIN;
  if (limit <= 0) return "";
  if (line.length <= limit) return line;
  return `${line.slice(0, Math.max(0, limit - 1))}…`;
};

/**
 * Format bytes with binary-prefixed suffixes (KB/MB/GB).
 *
 * @internal
 */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/**
 * Format milliseconds as h:mm:ss / mm:ss / s. Used for elapsed durations only.
 *
 * @internal
 */
export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (minutes < 60) return `${minutes}m${remSec.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return `${hours}h${remMin.toString().padStart(2, "0")}m${remSec.toString().padStart(2, "0")}s`;
};
