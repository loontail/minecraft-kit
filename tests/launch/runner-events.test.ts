import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { type MinecraftKitError, MinecraftKitErrorCodes } from "../../src/core/errors";
import { runLaunch } from "../../src/launch/runner";
import { AuthModes } from "../../src/types/auth";
import { EventTypes, type ProgressEvent } from "../../src/types/events";
import type { LaunchComposition } from "../../src/types/launch";
import type { ProcessStream, SpawnedProcess, Spawner } from "../../src/types/spawner";

const runtimeDir = mkdtempSync(path.join(tmpdir(), "mckit-launch-events-"));
const javaPath = path.join(runtimeDir, "java");
writeFileSync(javaPath, "#!/bin/sh\n");

const composition: LaunchComposition = {
  targetId: "target",
  directory: runtimeDir,
  javaPath,
  mainClass: "net.minecraft.client.main.Main",
  jvmArgs: ["-Xmx2G"],
  gameArgs: ["--username", "Player"],
  classpath: [],
  nativesDirectory: path.join(runtimeDir, "natives"),
  auth: { mode: AuthModes.OFFLINE, username: "Player" },
  workingDirectory: runtimeDir,
};

type Harness = {
  readonly spawner: Spawner;
  readonly emitStdout: (line: string) => void;
  readonly emitStderr: (line: string) => void;
  readonly resolveExit: (exit: {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }) => void;
  readonly kills: (NodeJS.Signals | undefined)[];
  readonly spawnOptions: { cwd: string; env?: Readonly<Record<string, string>> }[];
};

const harness = (): Harness => {
  const out = new EventEmitter();
  const err = new EventEmitter();
  const kills: (NodeJS.Signals | undefined)[] = [];
  const spawnOptions: { cwd: string; env?: Readonly<Record<string, string>> }[] = [];
  let resolveExit: Harness["resolveExit"] = () => {};
  const asStream = (emitter: EventEmitter): ProcessStream => ({
    on(event, listener) {
      if (event === "data") emitter.on("data", listener);
    },
  });
  const child: SpawnedProcess = {
    pid: 4242,
    stdout: asStream(out),
    stderr: asStream(err),
    exited: new Promise((resolve) => {
      resolveExit = resolve;
    }),
    kill(signal?: NodeJS.Signals): boolean {
      kills.push(signal);
      return true;
    },
  };
  return {
    spawner: {
      spawn: (_command, _args, options) => {
        spawnOptions.push(options as { cwd: string; env?: Readonly<Record<string, string>> });
        return child;
      },
    },
    emitStdout: (line) => out.emit("data", line),
    emitStderr: (line) => err.emit("data", line),
    resolveExit: (exit) => resolveExit(exit),
    kills,
    spawnOptions,
  };
};

afterAll(() => {
  rmSync(runtimeDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runLaunch event stream", () => {
  it("forwards the composed command, child output, and the exit", async () => {
    const h = harness();
    const events: ProgressEvent[] = [];

    const session = runLaunch({
      composition,
      spawner: h.spawner,
      options: { onEvent: (event) => events.push(event) },
    });
    h.emitStdout("[Render thread/INFO] Setting user");
    h.emitStderr("[LWJGL] warning");
    h.resolveExit({ code: 0, signal: null });

    await expect(session.exited).resolves.toEqual({ code: 0, signal: null, aborted: false });
    expect(session.pid).toBe(4242);
    expect(events).toEqual([
      {
        type: EventTypes.LAUNCH_STARTING,
        command: javaPath,
        // The main class must sit between the JVM args and the game args — swapping them makes
        // the JVM treat `--username` as a class name.
        args: ["-Xmx2G", "net.minecraft.client.main.Main", "--username", "Player"],
        cwd: runtimeDir,
      },
      { type: EventTypes.LAUNCH_STARTED, pid: 4242 },
      { type: EventTypes.LAUNCH_STDOUT, line: "[Render thread/INFO] Setting user" },
      { type: EventTypes.LAUNCH_STDERR, line: "[LWJGL] warning" },
      { type: EventTypes.LAUNCH_EXITED, code: 0, signal: null },
    ]);
  });

  it("forwards a composition env to the spawner and omits the key when unset", async () => {
    const withEnv = harness();
    runLaunch({
      composition: { ...composition, env: { JAVA_TOOL_OPTIONS: "" } },
      spawner: withEnv.spawner,
    });
    expect(withEnv.spawnOptions[0]).toEqual({
      cwd: runtimeDir,
      env: { JAVA_TOOL_OPTIONS: "" },
    });

    const withoutEnv = harness();
    runLaunch({ composition, spawner: withoutEnv.spawner });
    expect(withoutEnv.spawnOptions[0]).toEqual({ cwd: runtimeDir });
  });

  it("rejects with LAUNCH_PROCESS_FAILED on a non-zero exit that was not aborted", async () => {
    const h = harness();
    const events: ProgressEvent[] = [];

    const session = runLaunch({
      composition,
      spawner: h.spawner,
      options: { onEvent: (event) => events.push(event) },
    });
    h.resolveExit({ code: 1, signal: null });

    const failure = await session.exited.catch((error: unknown) => error);
    expect((failure as MinecraftKitError).code).toBe(MinecraftKitErrorCodes.LAUNCH_PROCESS_FAILED);
    expect((failure as MinecraftKitError).context).toMatchObject({ exitCode: 1 });
    // The exit event still fires: a crash log viewer must see the code even though `exited` rejects.
    expect(events.at(-1)).toEqual({ type: EventTypes.LAUNCH_EXITED, code: 1, signal: null });
  });

  // A user-cancelled launch exits non-zero on most platforms. Reporting that as a crash would
  // pop a "Minecraft crashed" dialog every time someone clicks Stop.
  it("resolves a non-zero exit that followed an abort", async () => {
    const h = harness();

    const session = runLaunch({ composition, spawner: h.spawner });
    session.abort("user");
    h.resolveExit({ code: 143, signal: null });

    await expect(session.exited).resolves.toEqual({
      code: 143,
      signal: null,
      aborted: true,
    });
  });

  it("resolves a null exit code without treating it as a failure", async () => {
    const h = harness();

    const session = runLaunch({ composition, spawner: h.spawner });
    h.resolveExit({ code: null, signal: "SIGKILL" });

    await expect(session.exited).resolves.toEqual({
      code: null,
      signal: "SIGKILL",
      aborted: false,
    });
  });

  it("escalates to SIGKILL when the child ignores SIGTERM for the grace period", async () => {
    vi.useFakeTimers();
    const h = harness();

    const session = runLaunch({
      composition,
      spawner: h.spawner,
      options: { killGracePeriodMs: 500 },
    });
    session.abort("stop");
    expect(h.kills).toEqual(["SIGTERM"]);

    await vi.advanceTimersByTimeAsync(500);
    expect(h.kills).toEqual(["SIGTERM", "SIGKILL"]);

    h.resolveExit({ code: null, signal: "SIGKILL" });
    await session.exited;
  });

  it("is idempotent: a second abort neither re-signals nor re-emits", async () => {
    const h = harness();
    const events: ProgressEvent[] = [];

    const session = runLaunch({
      composition,
      spawner: h.spawner,
      options: { onEvent: (event) => events.push(event) },
    });
    session.abort("first");
    session.abort("second");

    expect(h.kills).toEqual(["SIGTERM"]);
    expect(events.filter((event) => event.type === EventTypes.LAUNCH_ABORTED)).toEqual([
      { type: EventTypes.LAUNCH_ABORTED, reason: "first" },
    ]);

    h.resolveExit({ code: null, signal: "SIGTERM" });
    await session.exited;
  });

  it("does not signal a child that has already exited", async () => {
    const h = harness();

    const session = runLaunch({ composition, spawner: h.spawner });
    h.resolveExit({ code: 0, signal: null });
    await session.exited;

    session.abort("too late");

    expect(h.kills).toEqual([]);
  });

  it("kills immediately when the caller signal is already aborted at call time", async () => {
    const h = harness();
    const events: ProgressEvent[] = [];

    const session = runLaunch({
      composition,
      spawner: h.spawner,
      options: { signal: AbortSignal.abort("pre-aborted"), onEvent: (e) => events.push(e) },
    });

    expect(h.kills).toEqual(["SIGTERM"]);
    expect(events).toContainEqual({ type: EventTypes.LAUNCH_ABORTED, reason: "pre-aborted" });

    h.resolveExit({ code: null, signal: "SIGTERM" });
    await expect(session.exited).resolves.toMatchObject({ aborted: true });
  });

  it("renders every abort-reason shape a caller can raise", async () => {
    // `abort()` with no argument still carries a DOMException, so the reason is never absent
    // on a standard AbortSignal — the `undefined` fallback in the renderer is a guard for the
    // optional chain, not a reachable caller shape.
    const reasons: unknown[] = [undefined, "typed reason", new Error("boom"), { code: 7 }];
    const rendered: string[] = [];

    for (const reason of reasons) {
      const h = harness();
      const controller = new AbortController();
      const session = runLaunch({
        composition,
        spawner: h.spawner,
        options: {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === EventTypes.LAUNCH_ABORTED) rendered.push(event.reason);
          },
        },
      });
      controller.abort(reason);
      h.resolveExit({ code: null, signal: "SIGTERM" });
      await session.exited;
    }

    expect(rendered).toEqual([
      "This operation was aborted",
      "typed reason",
      "boom",
      "[object Object]",
    ]);
  });

  it("defaults the abort reason to `user` when abort() is called bare", async () => {
    const h = harness();
    const reasons: string[] = [];

    const session = runLaunch({
      composition,
      spawner: h.spawner,
      options: {
        onEvent: (event) => {
          if (event.type === EventTypes.LAUNCH_ABORTED) reasons.push(event.reason);
        },
      },
    });
    session.abort();

    expect(reasons).toEqual(["user"]);
    h.resolveExit({ code: null, signal: "SIGTERM" });
    await session.exited;
  });
});
