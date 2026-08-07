import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { SPAWNER_MAX_LINE_BYTES } from "../constants/defaults";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import type { ProcessStream, SpawnedProcess, Spawner, SpawnOptions } from "../types/spawner";

/**
 * Default spawner backed by `node:child_process.spawn`.
 *
 * Passing an explicit instance is equivalent to leaving the kit's `spawner` option unset.
 *
 * @example
 * ```ts
 * import { ChildProcessSpawner, MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit({ spawner: new ChildProcessSpawner() });
 * ```
 */
export class ChildProcessSpawner implements Spawner {
  spawn(command: string, args: readonly string[], options: SpawnOptions): SpawnedProcess {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = streamFromBuffer(child.stdout);
    const stderr = streamFromBuffer(child.stderr);
    const exited = new Promise<{
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
      // Without this listener a spawn failure (missing/unexecutable binary) is re-raised as
      // a process-level 'error' event — an uncaught exception in the host — and `exited`
      // never settles, hanging every awaiting caller.
      child.once("error", (cause: NodeJS.ErrnoException) => reject(toSpawnError(command, cause)));
    });
    return {
      pid: child.pid ?? -1,
      stdout,
      stderr,
      exited,
      kill(signal): boolean {
        return child.kill(signal);
      },
    };
  }
}

/**
 * Translate a `child_process` spawn failure into the kit error taxonomy. `ENOENT` means the
 * java binary itself is absent (`LAUNCH_JAVA_NOT_FOUND`, which consumers already classify as
 * "runtime needs repair"); everything else (`EACCES`, `EPERM`, `ENOEXEC`, `EMFILE`, …) is a
 * generic `LAUNCH_PROCESS_FAILED`.
 */
const toSpawnError = (command: string, cause: NodeJS.ErrnoException): MinecraftKitError => {
  const code =
    cause.code === "ENOENT"
      ? MinecraftKitErrorCodes.LAUNCH_JAVA_NOT_FOUND
      : MinecraftKitErrorCodes.LAUNCH_PROCESS_FAILED;
  return new MinecraftKitError(code, `Failed to spawn process: ${command}`, {
    cause,
    context: {
      filePath: command,
      ...(cause.code === undefined ? {} : { errno: cause.code }),
    },
  });
};

const streamFromBuffer = (stream: NodeJS.ReadableStream | null): ProcessStream => {
  if (!stream) {
    return { on() {} };
  }
  let buffer = "";
  const listeners = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const listener of listeners) listener(line);
  };
  stream.on("data", (chunk: Buffer | string) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    buffer += text;
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      emitBounded(emit, line);
      index = buffer.indexOf("\n");
    }
    buffer = flushNoNewlineOverflow(buffer, emit);
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      emitBounded(emit, buffer);
      buffer = "";
    }
    releaseSubscribersOnProducerEnd(listeners);
  });
  return {
    on(_event, listener) {
      listeners.add(listener);
    },
  };
};

const emitBounded = (emit: (line: string) => void, line: string): void => {
  if (line.length <= SPAWNER_MAX_LINE_BYTES) {
    emit(line);
    return;
  }
  for (let i = 0; i < line.length; i += SPAWNER_MAX_LINE_BYTES) {
    emit(line.slice(i, i + SPAWNER_MAX_LINE_BYTES));
  }
};

/**
 * Flush a buffer that is accumulating a single line longer than the per-line cap with no
 * newline in sight, in `SPAWNER_MAX_LINE_BYTES`-sized chunks. Returns the remaining buffer.
 *
 * Without this, a child that prints a multi-megabyte unterminated line would let `buffer`
 * grow without bound.
 */
const flushNoNewlineOverflow = (buffer: string, emit: (line: string) => void): string => {
  let remaining = buffer;
  while (remaining.length > SPAWNER_MAX_LINE_BYTES) {
    emit(remaining.slice(0, SPAWNER_MAX_LINE_BYTES));
    remaining = remaining.slice(SPAWNER_MAX_LINE_BYTES);
  }
  return remaining;
};

/**
 * Drop the subscriber set so callers that retain a reference to the {@link ProcessStream}
 * don't keep their listener closures alive for the lifetime of the owning process.
 */
const releaseSubscribersOnProducerEnd = (listeners: Set<(line: string) => void>): void => {
  listeners.clear();
};
