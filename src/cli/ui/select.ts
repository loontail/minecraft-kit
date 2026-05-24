/**
 * Select / searchable-select primitives backed by `@clack/prompts`.
 *
 * @internal
 * @packageDocumentation
 */

import type { ClackModule } from "./clack-bootstrap";
import type { SearchableSelectInput, SelectInput, SelectOption, WizardOutcome } from "./types";

/** Sentinel matched against the clack result so back/cancel are not confused with user values. */
const BACK = Symbol("mckit:back");
/** Sentinel matched against the clack result so an explicit "Cancel" option is detectable. */
const CANCEL = Symbol("mckit:cancel");

/**
 * Maximum number of options shown in a single select. Lists longer than this are clipped.
 *
 * @internal
 */
export const MAX_VISIBLE_OPTIONS = 50;

/**
 * Threshold above which {@link runSearchableSelect} clips its option list.
 *
 * @internal
 */
export const DEFAULT_SEARCH_THRESHOLD = 30;

type AugmentedOption = { label: string; value: unknown; hint?: string };

const toAugmentedOptions = <T>(options: readonly SelectOption<T>[]): AugmentedOption[] => {
  return options.map((option) => {
    const out: AugmentedOption = { label: option.label, value: option.value as unknown };
    if (option.hint !== undefined) out.hint = option.hint;
    return out;
  });
};

/**
 * Run a single clack select prompt. Appends back/cancel sentinel entries when requested
 * and translates the chosen value (or sentinel) into a {@link WizardOutcome}.
 *
 * @internal
 */
export const runSelect = async <T>(
  clack: ClackModule,
  input: SelectInput<T>,
): Promise<WizardOutcome<T>> => {
  const options = toAugmentedOptions(input.options);
  if (input.allowBack === true) {
    options.push({ label: "← Back", value: BACK });
  }
  if (input.allowCancel === true) {
    options.push({ label: "✕ Cancel", value: CANCEL });
  }
  const result = await clack.select({
    message: input.message,
    options,
    maxItems: 12,
    ...(input.initialValue !== undefined ? { initialValue: input.initialValue as unknown } : {}),
  });
  if (clack.isCancel(result)) return { kind: "cancel" };
  if (result === BACK) return { kind: "back" };
  if (result === CANCEL) return { kind: "cancel" };
  return { kind: "ok", value: result as T };
};

/**
 * Run a select that clips long lists to the first {@link MAX_VISIBLE_OPTIONS} entries. The
 * caller is responsible for sorting so the likely pick lands at the top; lists at or below
 * `searchThreshold` are rendered with {@link runSelect} unchanged. No inline filter is
 * offered — `clack.select` does not support it natively.
 *
 * @internal
 */
export const runSearchableSelect = async <T>(
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
