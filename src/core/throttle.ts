import type { ProgressEvent, ProgressListener } from "../types/events";

/**
 * Wrap a {@link ProgressListener} so high-frequency `download:progress` events are throttled
 * to at most one per `intervalMs`. Other event types pass through untouched.
 *
 * Throttling is per-target (event.file.target) so independent downloads don't starve each other.
 *
 * @internal
 */
export const throttleProgress = (
  listener: ProgressListener,
  intervalMs: number,
  now: () => number = () => Date.now(),
): ProgressListener => {
  const lastEmitByTarget = new Map<string, number>();
  return (event: ProgressEvent) => {
    if (event.type !== "download:progress") {
      listener(event);
      return;
    }
    const key = event.file.target;
    const last = lastEmitByTarget.get(key);
    const ts = now();
    if (last !== undefined && ts - last < intervalMs) {
      return;
    }
    lastEmitByTarget.set(key, ts);
    listener(event);
  };
};
