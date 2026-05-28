import { DEFAULT_KILL_GRACE_MS } from "../constants/defaults";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { EventTypes } from "../types/events";
import type {
  LaunchComposition,
  LaunchExit,
  LaunchRunOptions,
  LaunchSession,
} from "../types/launch";
import type { Spawner } from "../types/spawner";

/**
 * Inputs to {@link runLaunch}.
 *
 * @internal
 */
export type RunLaunchInput = {
  readonly composition: LaunchComposition;
  readonly options?: LaunchRunOptions;
  readonly spawner: Spawner;
};

/**
 * Spawn the configured Java process. Returns a {@link LaunchSession} immediately after the
 * process is created; the `exited` promise resolves when the game terminates.
 *
 * @internal
 */
export const runLaunch = (input: RunLaunchInput): LaunchSession => {
  const composition = input.composition;
  const options = input.options ?? {};
  const args = [...composition.jvmArgs, composition.mainClass, ...composition.gameArgs];
  options.onEvent?.({
    type: EventTypes.LAUNCH_STARTING,
    command: composition.javaPath,
    args,
    cwd: composition.workingDirectory,
  });
  const child = input.spawner.spawn(composition.javaPath, args, {
    cwd: composition.workingDirectory,
    ...(composition.env !== undefined ? { env: composition.env } : {}),
  });
  options.onEvent?.({ type: EventTypes.LAUNCH_STARTED, pid: child.pid });
  child.stdout.on("data", (line) => {
    options.onEvent?.({ type: EventTypes.LAUNCH_STDOUT, line });
  });
  child.stderr.on("data", (line) => {
    options.onEvent?.({ type: EventTypes.LAUNCH_STDERR, line });
  });

  const grace = options.killGracePeriodMs ?? DEFAULT_KILL_GRACE_MS;
  let aborted = false;
  let finished = false;
  let killTimer: NodeJS.Timeout | null = null;
  let onSignalAbort: (() => void) | null = null;
  const clearKillTimer = (): void => {
    if (killTimer === null) return;
    clearTimeout(killTimer);
    killTimer = null;
  };
  const removeAbortListener = (): void => {
    if (options.signal === undefined || onSignalAbort === null) return;
    options.signal.removeEventListener("abort", onSignalAbort);
    onSignalAbort = null;
  };
  const doAbort = (reason: string): void => {
    if (aborted || finished) return;
    aborted = true;
    options.onEvent?.({ type: EventTypes.LAUNCH_ABORTED, reason });
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), grace);
    killTimer.unref();
  };

  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      doAbort(reasonFrom(options.signal.reason));
    } else {
      onSignalAbort = () => doAbort(reasonFrom(options.signal?.reason));
      options.signal.addEventListener("abort", onSignalAbort, { once: true });
    }
  }

  const exited: Promise<LaunchExit> = (async () => {
    try {
      const { code, signal } = await child.exited;
      options.onEvent?.({ type: EventTypes.LAUNCH_EXITED, code, signal });
      if (!aborted && code !== 0 && code !== null) {
        throw new MinecraftKitError(
          MinecraftKitErrorCodes.LAUNCH_PROCESS_FAILED,
          `Minecraft process exited with code ${code}`,
          { context: { exitCode: code } },
        );
      }
      return { code, signal, aborted };
    } finally {
      finished = true;
      clearKillTimer();
      removeAbortListener();
    }
  })();

  return {
    pid: child.pid,
    exited,
    abort(reason?: string): void {
      doAbort(reason ?? "user");
    },
  };
};

const reasonFrom = (value: unknown): string => {
  if (value === undefined) return "aborted";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return String(value);
};
