/**
 * CLI UI contract. Defines the dialog primitives the scenarios consume; the production
 * implementation in {@link "../ui"} wires them onto `@clack/prompts`, the stub
 * implementation in {@link "./stub"} captures calls for tests. None of these types are
 * re-exported from `src/index.ts`.
 *
 * @internal
 * @packageDocumentation
 */

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
   * clipped to the first `MAX_VISIBLE_OPTIONS` entries. Defaults to `30`.
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
