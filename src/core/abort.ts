import { MinecraftKitError, MinecraftKitErrorCodes } from "./errors";
import type { PauseController } from "./pause-controller";

/**
 * The two checkpoint hooks that every long-running operation in the kit honours: caller
 * cancellation via `AbortSignal`, and caller pause/resume via {@link PauseController}.
 *
 * Wrap the pair so the call sites don't repeat the same three-line dance
 * (check signal -> await pause -> check signal again).
 *
 * @internal
 */
export type CheckpointSources = {
  readonly signal?: AbortSignal;
  readonly pauseController?: PauseController;
};

/**
 * Throw {@link MinecraftKitError} with code `LAUNCH_ABORTED` if the signal is aborted.
 *
 * `LAUNCH_ABORTED` is intentionally reused for install + launch + repair runners because
 * downstream code maps it to a single user-visible "operation cancelled" state.
 *
 * @internal
 */
export const assertNotAborted = (signal: AbortSignal | undefined, message: string): void => {
  if (signal?.aborted) {
    throw new MinecraftKitError(MinecraftKitErrorCodes.LAUNCH_ABORTED, message);
  }
};

/**
 * Wait while paused, abort-checking before and after. The double abort-check matters:
 * `pauseController.waitWhilePaused()` can resolve long after a cancel request, and the
 * caller should see the cancel rather than push another action through.
 *
 * @internal
 */
export const checkpoint = async (
  sources: CheckpointSources,
  message = "Operation aborted by signal",
): Promise<void> => {
  assertNotAborted(sources.signal, message);
  await sources.pauseController?.waitWhilePaused();
  assertNotAborted(sources.signal, message);
};
