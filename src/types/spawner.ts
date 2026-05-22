/**
 * Stream-of-text channel exposed by spawned processes.
 *
 * @example
 * ```ts
 * import type { ProcessStream } from "@loontail/minecraft-kit";
 *
 * const collect = (stream: ProcessStream): Promise<string[]> => {
 *   const lines: string[] = [];
 *   stream.on("data", (line) => lines.push(line));
 *   return Promise.resolve(lines);
 * };
 * ```
 */
export type ProcessStream = {
  on(event: "data", listener: (chunk: string) => void): void;
};

/**
 * Live handle for a child process.
 *
 * @example
 * ```ts
 * import type { SpawnedProcess } from "@loontail/minecraft-kit";
 *
 * const proc: SpawnedProcess = mySpawner.spawn("java", ["-version"], { cwd: process.cwd() });
 * proc.stderr.on("data", (line) => console.log(line));
 * const exit = await proc.exited;
 * console.log("exit code:", exit.code);
 * ```
 */
export type SpawnedProcess = {
  readonly pid: number;
  readonly stdout: ProcessStream;
  readonly stderr: ProcessStream;
  /** Resolves when the process exits with its exit info. */
  readonly exited: Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>;
  /** Send a termination signal. Returns true on success. */
  kill(signal?: NodeJS.Signals): boolean;
};

/**
 * Options accepted by the spawner.
 *
 * @example
 * ```ts
 * import type { SpawnOptions } from "@loontail/minecraft-kit";
 *
 * const options: SpawnOptions = {
 *   cwd: target.directory,
 *   env: { MINECRAFT_LAUNCHER: "my-launcher" },
 * };
 * ```
 */
export type SpawnOptions = {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
};

/**
 * Pluggable process spawner. The default implementation uses `node:child_process`; tests
 * inject a fake to avoid spawning real processes.
 *
 * @example
 * ```ts
 * import { MinecraftKit, type Spawner } from "@loontail/minecraft-kit";
 *
 * const fakeSpawner: Spawner = {
 *   spawn: () => ({
 *     pid: 1, stdout: { on() {} }, stderr: { on() {} },
 *     exited: Promise.resolve({ code: 0, signal: null }),
 *     kill: () => true,
 *   }),
 * };
 * const kit = new MinecraftKit({ spawner: fakeSpawner });
 * ```
 */
export type Spawner = {
  spawn(command: string, args: readonly string[], options: SpawnOptions): SpawnedProcess;
};
