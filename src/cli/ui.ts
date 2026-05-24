/**
 * Internal CLI UI facade. Exposed for the `mckit` binary, the scenario implementations,
 * and the test suite — never re-exported through `src/index.ts` or `src/cli/index.ts`,
 * so no consumer of `@loontail/minecraft-kit` should depend on anything in this file.
 *
 * Dialog primitives live in {@link "./ui/select"}, {@link "./ui/text"},
 * {@link "./ui/spinner"}; the production binding to `@clack/prompts` is in
 * {@link "./ui/clack-bootstrap"}; the test stub is {@link "./ui/stub"}. This file is just
 * the assembly point.
 *
 * @internal
 * @packageDocumentation
 */

import { type ClackModule, loadClackModule } from "./ui/clack-bootstrap";
import { runSearchableSelect, runSelect } from "./ui/select";
import { createInPlaceSpinner } from "./ui/spinner";
import { runConfirm, runText } from "./ui/text";
import type { Ui } from "./ui/types";

export type {
  ConfirmInput,
  SearchableSelectInput,
  SelectInput,
  SelectOption,
  TextInput,
  Ui,
  UiPromptInput,
  UiSpinner,
  WizardOutcome,
  WizardOutcomeKind,
} from "./ui/types";
export { WizardOutcomes } from "./ui/types";
export type { InPlaceSpinnerInput } from "./ui/spinner";
export { createInPlaceSpinner } from "./ui/spinner";
export type { StubUi, StubUiCall } from "./ui/stub";
export { createStubUi } from "./ui/stub";
export { DEFAULT_SEARCH_THRESHOLD, MAX_VISIBLE_OPTIONS } from "./ui/select";

/**
 * Build a {@link Ui} from any module that implements the clack contract. Exposed for tests
 * to inject a fake clack.
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
    text: (input) => runText(clack, input),
    select: (input) => runSelect(clack, input),
    searchableSelect: (input) => runSearchableSelect(clack, input),
    confirm: (input) => runConfirm(clack, input),
    spinner: () => createInPlaceSpinner(),
  };
};

/**
 * Build the production {@link Ui} backed by `@clack/prompts`. Lazy import keeps the CLI
 * dependency out of the library's main entry point.
 *
 * @internal
 */
export const createClackUi = async (): Promise<Ui> => {
  return buildUi(await loadClackModule());
};
