import { EventEmitter } from "node:events";
import type { ProcessStream, SpawnedProcess, Spawner, SpawnOptions } from "../../src/types/spawner";

/** A scripted spawn outcome. */
export type FakeSpawnSpec = {
  readonly stdout?: readonly string[];
  readonly stderr?: readonly string[];
  readonly exitCode: number;
  readonly delayMs?: number;
  /** When set, `exited` rejects with this error — the spawn-failure contract. */
  readonly failWith?: Error;
};

/** Test-only Spawner that returns scripted child processes. */
export class FakeSpawner implements Spawner {
  readonly invocations: { command: string; args: readonly string[]; options: SpawnOptions }[] = [];
  private readonly script: FakeSpawnSpec[] = [];

  push(spec: FakeSpawnSpec): this {
    this.script.push(spec);
    return this;
  }

  spawn(command: string, args: readonly string[], options: SpawnOptions): SpawnedProcess {
    this.invocations.push({ command, args, options });
    const spec = this.script.shift() ?? { exitCode: 0 };
    const stdoutEmitter = new EventEmitter();
    const stderrEmitter = new EventEmitter();
    const stdout: ProcessStream = {
      on(event, listener) {
        if (event === "data") stdoutEmitter.on("data", listener);
      },
    };
    const stderr: ProcessStream = {
      on(event, listener) {
        if (event === "data") stderrEmitter.on("data", listener);
      },
    };
    let killed = false;
    const exited = new Promise<{
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      const finish = (): void => {
        if (spec.failWith !== undefined) {
          reject(spec.failWith);
          return;
        }
        for (const line of spec.stdout ?? []) stdoutEmitter.emit("data", line);
        for (const line of spec.stderr ?? []) stderrEmitter.emit("data", line);
        resolve({ code: killed ? null : spec.exitCode, signal: killed ? "SIGTERM" : null });
      };
      if (spec.delayMs !== undefined && spec.delayMs > 0) {
        setTimeout(finish, spec.delayMs).unref();
      } else {
        setImmediate(finish);
      }
    });
    return {
      pid: Math.floor(Math.random() * 1e6),
      stdout,
      stderr,
      exited,
      kill(): boolean {
        killed = true;
        return true;
      },
    };
  }
}
