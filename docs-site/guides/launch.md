# Launch

Launching has two steps: compose a command, then spawn it.

```ts
import { AuthModes, EventTypes } from "@loontail/minecraft-kit";

const composition = await kit.launch.compose(target, {
  auth: { mode: AuthModes.OFFLINE, username: "Player" },
  memory: { minMb: 1024, maxMb: 4096 },
  resolution: { width: 1280, height: 720 },
});

const session = kit.launch.run(composition, {
  onEvent: (e) => {
    if (e.type === EventTypes.LAUNCH_STDOUT) console.log(`[mc] ${e.line}`);
  },
});
await session.exited;
```

## Compose

`compose()` returns a `LaunchComposition`:

```ts
interface LaunchComposition {
  readonly targetId: string;
  readonly directory: string;
  readonly javaPath: string;
  readonly mainClass: string;
  readonly jvmArgs: readonly string[];
  readonly gameArgs: readonly string[];
  readonly classpath: readonly string[];
  readonly nativesDirectory: string;
  readonly auth: LaunchAuth;
  readonly workingDirectory: string;
  readonly env?: Readonly<Record<string, string>>;
}
```

It reads the on-disk `versions/<id>/<id>.json` for the chosen loader, walks the
`inheritsFrom` chain to find the vanilla manifest, builds the classpath, resolves every
`${...}` placeholder against the auth + paths, and returns a deterministic command line. No
process is spawned.

Log, diff, persist, or modify the composition before passing it to `run()`.

## Run

`run()` spawns the Java process via the injected `Spawner` (default
`ChildProcessSpawner`). The returned `LaunchSession`:

```ts
interface LaunchSession {
  readonly pid: number;
  readonly exited: Promise<LaunchExit>;
  abort(reason?: string): void;
}
```

- `exited` resolves with `{ code, signal, aborted }`. It rejects with
  `LAUNCH_PROCESS_FAILED` only when the process exits non-zero **and** was not aborted.
- `abort(reason)` sends `SIGTERM`, then `SIGKILL` after a grace period (`DEFAULT_KILL_GRACE_MS`,
  5 s). Idempotent — calling it twice is a no-op.
- Passing an `AbortSignal` via `options.signal` aborts the launch when it fires.

The `onEvent` callback receives `launch:starting`, `launch:started`, `launch:stdout`,
`launch:stderr`, `launch:exited`, and `launch:aborted` events. Long lines are split at
`SPAWNER_MAX_LINE_BYTES` (64 KiB) so a pathological Minecraft crash dump cannot exhaust
launcher memory.

## Auth modes

```ts
{ mode: AuthModes.OFFLINE, username: "Player" }
{ mode: AuthModes.OFFLINE, username: "Player", uuid: "00000000-0000-0000-0000-000000000000" }
{
  mode: AuthModes.ONLINE,
  username: "Player",
  uuid: "...",
  accessToken: "...",
  userType: "msa",
  clientId: "...",
  xuid: "...",
}
```

`AuthModes.OFFLINE` derives the UUID from `MD5("OfflinePlayer:" + name)` (Mojang's offline
formula) when no UUID is given, and sends `0` as the access token.
