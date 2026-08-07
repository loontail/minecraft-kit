import type { ProgressListener } from "../types/events";
import type { PauseController } from "./pause-controller";

/**
 * Conditional-spread helpers that hide the `exactOptionalPropertyTypes` dance.
 *
 * Under `exactOptionalPropertyTypes: true`, `{ signal: undefined }` and `{}` are not the
 * same type — so call sites can't pass `undefined` to a `signal?: AbortSignal` slot and
 * have to fall back to a spread (`...(signal !== undefined ? { signal } : {})`). The
 * helpers below collapse that spread into one named call per option.
 *
 * @internal
 */

export const withOptionalSignal = (signal: AbortSignal | undefined): { signal?: AbortSignal } =>
  signal === undefined ? {} : { signal };

export const withOptionalOnEvent = (
  onEvent: ProgressListener | undefined,
): { onEvent?: ProgressListener } => (onEvent === undefined ? {} : { onEvent });

export const withOptionalPauseController = (
  pauseController: PauseController | undefined,
): { pauseController?: PauseController } =>
  pauseController === undefined ? {} : { pauseController };

export const withOptionalHostAllowList = (
  hostAllowList: readonly string[] | undefined,
): { hostAllowList?: readonly string[] } => (hostAllowList === undefined ? {} : { hostAllowList });
