import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { SPAWNER_MAX_LINE_BYTES } from "../constants/defaults";
import type { ProcessStream, SpawnOptions, SpawnedProcess, Spawner } from "../types/spawner";

/**
 * Default spawner backed by `node:child_process.spawn`.
 *
 * @example
 * ```ts
 * import { ChildProcessSpawner, MinecraftKit } from "@loontail/minecraft-kit";
 *
 * // Explicit instantiation — equivalent to leaving `spawner` unset.
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
    }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
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
    // Pathological input: a single line longer than the cap with no newline yet. Flush in
    // chunks so the buffer cannot grow without bound.
    while (buffer.length > SPAWNER_MAX_LINE_BYTES) {
      emit(buffer.slice(0, SPAWNER_MAX_LINE_BYTES));
      buffer = buffer.slice(SPAWNER_MAX_LINE_BYTES);
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      emitBounded(emit, buffer);
      buffer = "";
    }
    // The producer is done — clear the subscriber set so callers that retain a reference to
    // the ProcessStream don't keep their listener closures alive for the lifetime of the
    // owning process.
    listeners.clear();
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
