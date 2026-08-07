import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthModes } from "../../src";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../../src/core/errors";
import { runLaunch } from "../../src/launch/runner";
import type { LaunchComposition } from "../../src/types/launch";
import type { ProcessStream, SpawnedProcess, Spawner } from "../../src/types/spawner";

const composition: LaunchComposition = {
  targetId: "target",
  directory: "/minecraft",
  javaPath: "/runtime/bin/java",
  mainClass: "net.minecraft.client.main.Main",
  jvmArgs: [],
  gameArgs: [],
  classpath: [],
  nativesDirectory: "/minecraft/versions/target/natives",
  auth: { mode: AuthModes.OFFLINE, username: "Player" },
  workingDirectory: "/minecraft",
};

const stream: ProcessStream = {
  on() {},
};

const createControlledSpawner = (): {
  readonly spawner: Spawner;
  readonly kills: readonly (NodeJS.Signals | undefined)[];
  readonly resolveExit: (exit: {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }) => void;
  readonly rejectExit: (error: unknown) => void;
} => {
  const kills: (NodeJS.Signals | undefined)[] = [];
  let resolveExit: (exit: {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }) => void = () => {};
  let rejectExit: (error: unknown) => void = () => {};
  const child: SpawnedProcess = {
    pid: 123,
    stdout: stream,
    stderr: stream,
    exited: new Promise((resolve, reject) => {
      resolveExit = resolve;
      rejectExit = reject;
    }),
    kill(signal?: NodeJS.Signals): boolean {
      kills.push(signal);
      return true;
    },
  };
  return {
    spawner: {
      spawn: () => child,
    },
    kills,
    resolveExit,
    rejectExit,
  };
};

describe("runLaunch", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clears the pending SIGKILL timer when an aborted process exits", async () => {
    vi.useFakeTimers();
    const { spawner, kills, resolveExit } = createControlledSpawner();

    const session = runLaunch({
      composition,
      spawner,
      options: { killGracePeriodMs: 1_000 },
    });
    session.abort("test");

    expect(kills).toEqual(["SIGTERM"]);

    resolveExit({ code: null, signal: "SIGTERM" });
    await session.exited;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(kills).toEqual(["SIGTERM"]);
  });

  it("removes the abort listener after the child exits", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const { spawner, kills, resolveExit } = createControlledSpawner();

    const session = runLaunch({
      composition,
      spawner,
      options: { signal: controller.signal },
    });

    resolveExit({ code: 0, signal: null });
    await session.exited;

    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));

    controller.abort("late");
    expect(kills).toEqual([]);
  });

  it("propagates a spawn failure and still cleans up the abort listener", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const { spawner, kills, rejectExit } = createControlledSpawner();
    const spawnFailure = new MinecraftKitError(
      MinecraftKitErrorCodes.LAUNCH_JAVA_NOT_FOUND,
      "Failed to spawn process: /runtime/bin/java",
    );

    const session = runLaunch({
      composition,
      spawner,
      options: { signal: controller.signal },
    });

    rejectExit(spawnFailure);

    await expect(session.exited).rejects.toBe(spawnFailure);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));

    controller.abort("late");
    expect(kills).toEqual([]);
  });

  it("clears the pending SIGKILL timer when the spawn itself fails after an abort", async () => {
    vi.useFakeTimers();
    const { spawner, kills, rejectExit } = createControlledSpawner();

    const session = runLaunch({
      composition,
      spawner,
      options: { killGracePeriodMs: 1_000 },
    });
    session.abort("test");
    rejectExit(new MinecraftKitError(MinecraftKitErrorCodes.LAUNCH_PROCESS_FAILED, "spawn EACCES"));

    await expect(session.exited).rejects.toBeInstanceOf(MinecraftKitError);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(kills).toEqual(["SIGTERM"]);
  });
});
