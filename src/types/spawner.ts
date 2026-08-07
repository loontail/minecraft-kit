/**
 * Stream-of-text channel exposed by spawned processes.
 */
export type ProcessStream = {
  on(event: "data", listener: (chunk: string) => void): void;
};

/**
 * Live handle for a child process.
 */
export type SpawnedProcess = {
  readonly pid: number;
  readonly stdout: ProcessStream;
  readonly stderr: ProcessStream;
  /**
   * Resolves when the process exits with its exit info.
   *
   * @remarks
   * Implementations MUST also settle this promise when the process could not be spawned at
   * all, by rejecting with a `MinecraftKitError` whose code is `LAUNCH_JAVA_NOT_FOUND`
   * (binary missing) or `LAUNCH_PROCESS_FAILED` (any other spawn failure). Leaving it
   * pending hangs `launch.run` and the Forge processor stage forever.
   */
  readonly exited: Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>;
  /** Send a termination signal. Returns true on success. */
  kill(signal?: NodeJS.Signals): boolean;
};

/**
 * Options accepted by the spawner.
 */
export type SpawnOptions = {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
};

/**
 * Pluggable process spawner. The default implementation uses `node:child_process`; tests
 * inject a fake to avoid spawning real processes.
 */
export type Spawner = {
  spawn(command: string, args: readonly string[], options: SpawnOptions): SpawnedProcess;
};
