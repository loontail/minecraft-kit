/**
 * Single-line in-place spinner used by every long-running CLI scenario. Preferred over
 * `clack.spinner()` because clack's spinner prints a fresh line per update on Windows /
 * older versions, defeating in-place rendering.
 *
 * On a TTY each update overwrites the same line via `\r\x1b[2K` (carriage return +
 * ANSI clear-line); on a non-TTY the first message is committed with a newline and
 * subsequent `message()` calls are suppressed, so CI logs do not get spammed.
 *
 * @internal
 * @packageDocumentation
 */

import { assertNever } from "../../core/assert-never";
import type { UiSpinner } from "./types";

/**
 * Writable stream the spinner targets. Subset of `process.stdout` so tests can swap it.
 *
 * @internal
 */
export type SpinnerStream = {
  write(chunk: string): void;
  isTTY: boolean;
};

const DEFAULT_OUT: SpinnerStream = {
  write(chunk) {
    process.stdout.write(chunk);
  },
  get isTTY() {
    return process.stdout.isTTY === true;
  },
};

/**
 * Inputs to {@link createInPlaceSpinner}.
 *
 * @internal
 */
export type InPlaceSpinnerInput = {
  /** Sink the spinner writes to. Defaults to `process.stdout`. */
  readonly out?: SpinnerStream;
};

type SpinnerState =
  | { readonly kind: "idle" }
  | { readonly kind: "tty-running"; readonly lastLine: string }
  | { readonly kind: "non-tty-running"; readonly lastLine: string };

/**
 * Write `message` to the spinner sink, overwriting whatever is currently on the spinner
 * line. Emits `\r\x1b[2K` on a TTY; falls back to `${message}\n` on non-TTYs.
 */
const writeClearedLine = (out: SpinnerStream, message: string): void => {
  if (out.isTTY) {
    out.write(`\r\x1b[2K${message}`);
  } else {
    out.write(`${message}\n`);
  }
};

/**
 * Build a {@link UiSpinner} that updates a single terminal line in place by writing raw
 * ANSI escape codes. Falls back to one line per call when the stream is not a TTY (CI
 * logs, redirected stdout) so it never spams the output.
 *
 * @internal
 */
export const createInPlaceSpinner = (input: InPlaceSpinnerInput = {}): UiSpinner => {
  const out = input.out ?? DEFAULT_OUT;
  const runningKind: "tty-running" | "non-tty-running" = out.isTTY
    ? "tty-running"
    : "non-tty-running";
  let state: SpinnerState = { kind: "idle" };
  return {
    start(message: string): void {
      switch (state.kind) {
        case "idle":
          state = { kind: runningKind, lastLine: message };
          if (out.isTTY) out.write(message);
          else out.write(`${message}\n`);
          return;
        case "tty-running":
        case "non-tty-running":
          if (state.lastLine === message) return;
          state = { kind: state.kind, lastLine: message };
          writeClearedLine(out, message);
          return;
        default:
          assertNever(state);
      }
    },
    message(message: string): void {
      switch (state.kind) {
        case "idle":
          return;
        case "tty-running":
          if (state.lastLine === message) return;
          state = { kind: "tty-running", lastLine: message };
          out.write(`\r\x1b[2K${message}`);
          return;
        case "non-tty-running":
          if (state.lastLine === message) return;
          state = { kind: "non-tty-running", lastLine: message };
          return;
        default:
          assertNever(state);
      }
    },
    stop(message?: string): void {
      switch (state.kind) {
        case "idle":
          if (message !== undefined) out.write(`${message}\n`);
          return;
        case "tty-running": {
          const finalText = message ?? state.lastLine;
          out.write(`\r\x1b[2K${finalText}\n`);
          state = { kind: "idle" };
          return;
        }
        case "non-tty-running": {
          const finalText = message ?? state.lastLine;
          out.write(`${finalText}\n`);
          state = { kind: "idle" };
          return;
        }
        default:
          assertNever(state);
      }
    },
  };
};
