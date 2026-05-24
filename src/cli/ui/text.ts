/**
 * Text and confirm primitives backed by `@clack/prompts`.
 *
 * @internal
 * @packageDocumentation
 */

import type { ClackModule } from "./clack-bootstrap";
import type { ConfirmInput, TextInput, WizardOutcome } from "./types";

/**
 * Run a single clack text prompt. Translates a cancel into a {@link WizardOutcome.kind}
 * of `"cancel"`; the empty-string fallback covers the case where clack returns `undefined`
 * on a validator skip.
 *
 * @internal
 */
export const runText = async (
  clack: ClackModule,
  input: TextInput,
): Promise<WizardOutcome<string>> => {
  const value = await clack.text({
    message: input.message,
    ...(input.placeholder !== undefined ? { placeholder: input.placeholder } : {}),
    ...(input.initial !== undefined ? { initialValue: input.initial } : {}),
    ...(input.validate !== undefined ? { validate: input.validate } : {}),
  });
  if (clack.isCancel(value)) return { kind: "cancel" };
  return { kind: "ok", value: typeof value === "string" ? value : "" };
};

/**
 * Run a single clack confirm prompt. The boolean cast is safe because clack returns a
 * boolean on success and a cancel sentinel otherwise, and the latter is caught above.
 *
 * @internal
 */
export const runConfirm = async (
  clack: ClackModule,
  input: ConfirmInput,
): Promise<WizardOutcome<boolean>> => {
  const value = await clack.confirm({
    message: input.message,
    ...(input.initial !== undefined ? { initialValue: input.initial } : {}),
  });
  if (clack.isCancel(value)) return { kind: "cancel" };
  return { kind: "ok", value: value as boolean };
};
