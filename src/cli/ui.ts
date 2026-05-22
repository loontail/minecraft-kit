/**
 * Internal CLI UI contract. Exposed for the `mckit` binary, the scenario implementations,
 * and the test suite — never re-exported through `src/index.ts` or `src/cli/index.ts`,
 * so no consumer of `@loontail/minecraft-kit` should depend on anything in this file.
 *
 * @internal
 * @packageDocumentation
 */

import { assertNever } from "../core/assert-never";

/**
 * Discriminator values for {@link WizardOutcome}.
 *
 * @internal
 */
export const WizardOutcomes = {
  OK: "ok",
  BACK: "back",
  CANCEL: "cancel",
} as const;

/**
 * Literal union of {@link WizardOutcome} discriminators.
 *
 * @internal
 */
export type WizardOutcomeKind = (typeof WizardOutcomes)[keyof typeof WizardOutcomes];

/**
 * Outcome of a single interactive step.
 *
 * - `ok`     — user picked a value.
 * - `back`   — user asked to go to the previous step (only available when {@link UiPromptInput.allowBack}).
 * - `cancel` — user pressed Ctrl+C, picked the explicit "Cancel" option, or otherwise aborted.
 *
 * @internal
 */
export type WizardOutcome<T> =
  | { readonly kind: typeof WizardOutcomes.OK; readonly value: T }
  | { readonly kind: typeof WizardOutcomes.BACK }
  | { readonly kind: typeof WizardOutcomes.CANCEL };

/**
 * A select option.
 *
 * @internal
 */
export type SelectOption<T> = {
  readonly label: string;
  readonly value: T;
  readonly hint?: string;
};

/**
 * Common shape for every interactive prompt input.
 *
 * @internal
 */
export type UiPromptInput = {
  readonly message: string;
  readonly allowBack?: boolean;
  readonly allowCancel?: boolean;
};

/**
 * Inputs for {@link Ui.text}.
 *
 * @internal
 */
export type TextInput = UiPromptInput & {
  readonly placeholder?: string;
  readonly initial?: string;
  /** Optional validator. Return undefined for valid input or an error message string. */
  readonly validate?: (value: string) => string | undefined;
};

/**
 * Inputs for {@link Ui.select}.
 *
 * @internal
 */
export type SelectInput<T> = UiPromptInput & {
  readonly options: readonly SelectOption<T>[];
  /** Optional initial selection. */
  readonly initialValue?: T;
};

/**
 * Inputs for {@link Ui.searchableSelect}.
 *
 * @internal
 */
export type SearchableSelectInput<T> = SelectInput<T> & {
  /**
   * Lists with at most this many entries are rendered as a normal select. Larger lists are
   * clipped to the first {@link MAX_VISIBLE_OPTIONS} entries. Defaults to `30`.
   */
  readonly searchThreshold?: number;
};

/**
 * Inputs for {@link Ui.confirm}.
 *
 * @internal
 */
export type ConfirmInput = UiPromptInput & {
  readonly initial?: boolean;
};

/**
 * Spinner handle.
 *
 * @internal
 */
export type UiSpinner = {
  /** Start the spinner with an initial message. */
  start(message: string): void;
  /** Update the running spinner's message in-place (no newline). */
  message(message: string): void;
  /** Stop the spinner with a final message. */
  stop(message?: string): void;
};

/**
 * Public interactive-UI contract.
 *
 * @internal
 */
export type Ui = {
  intro(message: string): void;
  outro(message: string): void;
  note(title: string, body: string): void;
  log(level: "info" | "success" | "warn" | "error", message: string): void;
  /** Print a raw multi-line block without any clack box/prefix decoration. */
  write(message: string): void;
  text(input: TextInput): Promise<WizardOutcome<string>>;
  select<T>(input: SelectInput<T>): Promise<WizardOutcome<T>>;
  searchableSelect<T>(input: SearchableSelectInput<T>): Promise<WizardOutcome<T>>;
  confirm(input: ConfirmInput): Promise<WizardOutcome<boolean>>;
  spinner(): UiSpinner;
};

const BACK = Symbol("mckit:back");
const CANCEL = Symbol("mckit:cancel");

type ClackModule = {
  intro(m: string): void;
  outro(m: string): void;
  note(body: string, title?: string): void;
  log: {
    info(m: string): void;
    success(m: string): void;
    warn(m: string): void;
    error(m: string): void;
  };
  text(opts: object): Promise<unknown>;
  select(opts: object): Promise<unknown>;
  confirm(opts: object): Promise<unknown>;
  spinner(): {
    start(m: string): void;
    stop(m?: string): void;
    message?(m: string): void;
  };
  isCancel(value: unknown): boolean;
};

/**
 * Build the production {@link Ui} backed by `@clack/prompts`. Lazy import keeps the CLI
 * dependency out of the library's main entry point.
 *
 * @internal
 */
export const createClackUi = async (): Promise<Ui> => {
  let clack: ClackModule;
  try {
    clack = (await import("@clack/prompts")) as unknown as ClackModule;
  } catch {
    throw new Error(
      "The `mckit` CLI requires the optional dependency `@clack/prompts`. Install it with `npm install @clack/prompts` (or run `npm install` without `--omit=optional`).",
    );
  }
  return buildUi(clack);
};

/**
 * Maximum number of options shown in a single select. Above this, a filter is required.
 *
 * @internal
 */
export const MAX_VISIBLE_OPTIONS = 50;

/**
 * Threshold above which {@link Ui.searchableSelect} prompts for a filter first.
 *
 * @internal
 */
export const DEFAULT_SEARCH_THRESHOLD = 30;

/**
 * Build a {@link Ui} from any module that implements the clack contract. Exposed for tests.
 *
 * @internal
 */
export const buildUi = (clack: ClackModule): Ui => {
  return {
    intro: (m) => clack.intro(m),
    outro: (m) => clack.outro(m),
    write: (m) => process.stdout.write(`${m}\n`),
    note: (title, body) => clack.note(body, title),
    log: (level, message) => clack.log[level](message),
    text: async (input) => {
      const value = await clack.text({
        message: input.message,
        ...(input.placeholder !== undefined ? { placeholder: input.placeholder } : {}),
        ...(input.initial !== undefined ? { initialValue: input.initial } : {}),
        ...(input.validate !== undefined ? { validate: input.validate } : {}),
      });
      if (clack.isCancel(value)) return { kind: "cancel" };
      return { kind: "ok", value: typeof value === "string" ? value : "" };
    },
    select: async (input) => runSelect(clack, input),
    searchableSelect: async (input) => searchableSelect(clack, input),
    confirm: async (input) => {
      const value = await clack.confirm({
        message: input.message,
        ...(input.initial !== undefined ? { initialValue: input.initial } : {}),
      });
      if (clack.isCancel(value)) return { kind: "cancel" };
      return { kind: "ok", value: value as boolean };
    },
    spinner: () => createInPlaceSpinner(),
  };
};

/**
 * Default writable stream used by the in-place spinner. Wrapped so tests can swap it.
 */
const DEFAULT_OUT: { write(chunk: string): void; isTTY: boolean } = {
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
  readonly out?: { write(chunk: string): void; isTTY: boolean };
};

/**
 * Write `message` to the spinner sink, overwriting whatever is currently on
 * the spinner line. Emits a carriage return + ANSI clear-line escape
 * (`\r\x1b[2K`) on a TTY; falls back to `${message}\n` on non-TTYs.
 *
 * @internal
 */
const writeClearedLine = (
  out: { write(chunk: string): void; isTTY: boolean },
  message: string,
): void => {
  if (out.isTTY) {
    out.write(`\r\x1b[2K${message}`);
  } else {
    out.write(`${message}\n`);
  }
};

/**
 * Build a {@link UiSpinner} that updates a single terminal line in place by writing raw
 * ANSI escape codes (`\r\x1b[2K` — carriage return + clear-line) before each update. Falls
 * back to one line per call when the stream is not a TTY (CI logs, redirected stdout) so it
 * never spams the output.
 *
 * Used in preference to `clack.spinner()` because clack's spinner sometimes
 * prints a fresh line per update on Windows / older versions, defeating
 * in-place rendering.
 *
 * Exposed for tests; the production {@link Ui} created by {@link createClackUi} already uses
 * this internally.
 *
 * @internal
 */
type SpinnerState =
  | { readonly kind: "idle" }
  | { readonly kind: "tty-running"; readonly lastLine: string }
  | { readonly kind: "non-tty-running"; readonly lastLine: string };

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

const runSelect = async <T>(
  clack: ClackModule,
  input: SelectInput<T>,
): Promise<WizardOutcome<T>> => {
  const augmentedOptions: { label: string; value: unknown; hint?: string }[] = input.options.map(
    (option) => {
      const opt: { label: string; value: unknown; hint?: string } = {
        label: option.label,
        value: option.value as unknown,
      };
      if (option.hint !== undefined) opt.hint = option.hint;
      return opt;
    },
  );
  if (input.allowBack === true) {
    augmentedOptions.push({ label: "← Back", value: BACK });
  }
  if (input.allowCancel === true) {
    augmentedOptions.push({ label: "✕ Cancel", value: CANCEL });
  }
  const result = await clack.select({
    message: input.message,
    options: augmentedOptions,
    maxItems: 12,
    ...(input.initialValue !== undefined ? { initialValue: input.initialValue as unknown } : {}),
  });
  if (clack.isCancel(result)) return { kind: "cancel" };
  if (result === BACK) return { kind: "back" };
  if (result === CANCEL) return { kind: "cancel" };
  return { kind: "ok", value: result as T };
};

/**
 * Run a select prompt that clips long lists to the first {@link MAX_VISIBLE_OPTIONS}
 * entries (the caller is responsible for sorting newest-first or otherwise putting
 * the likely-pick at the top). Lists at or below `searchThreshold` use the regular
 * select. No inline-autocomplete affordance is offered because `clack.select` does
 * not support it natively, and a dedicated "filter" entry adds noise without a
 * clear win.
 *
 * @internal
 */
const searchableSelect = async <T>(
  clack: ClackModule,
  input: SearchableSelectInput<T>,
): Promise<WizardOutcome<T>> => {
  const threshold = input.searchThreshold ?? DEFAULT_SEARCH_THRESHOLD;
  if (input.options.length <= threshold) {
    return runSelect(clack, input);
  }
  const trimmed = input.options.slice(0, MAX_VISIBLE_OPTIONS);
  const truncatedHint =
    input.options.length > MAX_VISIBLE_OPTIONS
      ? ` (top ${MAX_VISIBLE_OPTIONS} of ${input.options.length})`
      : "";
  return runSelect<T>(clack, {
    message: `${input.message}${truncatedHint}`,
    options: trimmed,
    ...(input.allowBack === true ? { allowBack: true } : {}),
    ...(input.allowCancel === true ? { allowCancel: true } : {}),
  });
};

/**
 * Stub UI used by tests. Each prompt consumes one entry from `script`. Allowed entries:
 *
 * - a plain value (success path);
 * - the literal strings `"back"` / `"cancel"` as shorthand outcomes;
 * - a {@link WizardOutcome} object directly.
 *
 * The stub also captures every log/note/intro/outro call so tests can assert on them.
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
