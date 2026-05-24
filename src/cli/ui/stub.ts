/**
 * Test-only {@link Ui} implementation. Each prompt consumes one entry from `script`;
 * every prompt / log / spinner call is captured in `calls` for assertions.
 *
 * @internal
 * @packageDocumentation
 */

import type { Ui, WizardOutcome } from "./types";

/**
 * Recorded stub-UI call.
 *
 * @internal
 */
export type StubUiCall = {
  readonly kind:
    | "intro"
    | "outro"
    | "note"
    | "log"
    | "write"
    | "text"
    | "select"
    | "search"
    | "confirm"
    | "spinner-start"
    | "spinner-message"
    | "spinner-stop";
  readonly message: string;
  readonly level?: "info" | "success" | "warn" | "error";
  readonly body?: string;
};

/**
 * Stub UI handle (extends {@link Ui} with a `calls` log for test assertions).
 *
 * @internal
 */
export type StubUi = Ui & {
  readonly calls: readonly StubUiCall[];
};

/**
 * Build a {@link StubUi}. Allowed `script` entries:
 *
 * - a plain value (success path);
 * - the literal strings `"back"` / `"cancel"` as shorthand outcomes;
 * - a {@link WizardOutcome} object directly.
 *
 * @internal
 */
export const createStubUi = (script: readonly unknown[] = []): StubUi => {
  const queue = [...script];
  const calls: StubUiCall[] = [];
  function consume<T>(prompt: StubUiCall): WizardOutcome<T> {
    calls.push(prompt);
    if (queue.length === 0) {
      throw new Error(`Stub UI exhausted before prompt: ${prompt.kind} "${prompt.message}"`);
    }
    const next = queue.shift();
    if (next === "back") return { kind: "back" };
    if (next === "cancel") return { kind: "cancel" };
    if (
      typeof next === "object" &&
      next !== null &&
      "kind" in next &&
      ((next as WizardOutcome<T>).kind === "back" || (next as WizardOutcome<T>).kind === "cancel")
    ) {
      return next as WizardOutcome<T>;
    }
    return { kind: "ok", value: next as T };
  }
  return {
    calls,
    intro: (m) => calls.push({ kind: "intro", message: m }),
    outro: (m) => calls.push({ kind: "outro", message: m }),
    write: (m) => calls.push({ kind: "write", message: m }),
    note: (title, body) => calls.push({ kind: "note", message: title, body }),
    log: (level, m) => calls.push({ kind: "log", message: m, level }),
    text: async (input) => consume({ kind: "text", message: input.message }),
    select: async (input) => consume({ kind: "select", message: input.message }),
    searchableSelect: async (input) => consume({ kind: "search", message: input.message }),
    confirm: async (input) => consume({ kind: "confirm", message: input.message }),
    spinner: () => ({
      start: (m) => calls.push({ kind: "spinner-start", message: m }),
      message: (m) => calls.push({ kind: "spinner-message", message: m }),
      stop: (m) => calls.push({ kind: "spinner-stop", message: m ?? "" }),
    }),
  };
};
