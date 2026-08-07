import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../../src/core/errors";
import { ChildProcessSpawner } from "../../src/launch/spawner";

const MISSING_BINARY = path.join(path.sep, "definitely", "missing", "mckit-java-does-not-exist");

/**
 * Capture process-level uncaught exceptions for the duration of `run`. A spawn failure that
 * is not translated into a rejected `exited` surfaces here and kills a host process that has
 * no handler of its own.
 */
const withUncaughtExceptionSpy = async <T>(
  run: () => Promise<T>,
): Promise<{ readonly result: T; readonly uncaught: readonly unknown[] }> => {
  const uncaught: unknown[] = [];
  const listener = (error: unknown): void => {
    uncaught.push(error);
  };
  const existing = process.listeners("uncaughtException");
  for (const handler of existing) process.removeListener("uncaughtException", handler);
  process.on("uncaughtException", listener);
  try {
    const result = await run();
    await new Promise((resolve) => setImmediate(resolve));
    return { result, uncaught };
  } finally {
    process.removeListener("uncaughtException", listener);
    for (const handler of existing) process.on("uncaughtException", handler);
  }
};

describe("ChildProcessSpawner spawn failures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects `exited` with LAUNCH_JAVA_NOT_FOUND instead of throwing uncaught", async () => {
    const spawner = new ChildProcessSpawner();

    const { result, uncaught } = await withUncaughtExceptionSpy(async () => {
      const child = spawner.spawn(MISSING_BINARY, ["-version"], { cwd: process.cwd() });
      return await child.exited.then(
        () => null,
        (error: unknown) => error,
      );
    });

    expect(result).toBeInstanceOf(MinecraftKitError);
    expect((result as MinecraftKitError).code).toBe(MinecraftKitErrorCodes.LAUNCH_JAVA_NOT_FOUND);
    expect((result as MinecraftKitError).context.filePath).toBe(MISSING_BINARY);
    expect(uncaught).toEqual([]);
  });

  it("maps a non-ENOENT spawn failure to LAUNCH_PROCESS_FAILED", async () => {
    const { spawn } = await import("node:child_process");
    const fakeChild = new EventEmitter() as EventEmitter & {
      stdout: null;
      stderr: null;
      pid: undefined;
      kill: () => boolean;
    };
    fakeChild.stdout = null;
    fakeChild.stderr = null;
    fakeChild.pid = undefined;
    fakeChild.kill = () => false;
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValueOnce(fakeChild as never);

    const child = new ChildProcessSpawner().spawn("/bin/blocked", [], { cwd: process.cwd() });
    const denied: NodeJS.ErrnoException = Object.assign(new Error("spawn EACCES"), {
      code: "EACCES",
    });
    fakeChild.emit("error", denied);

    await expect(child.exited).rejects.toMatchObject({
      code: MinecraftKitErrorCodes.LAUNCH_PROCESS_FAILED,
    });
  });

  it("keeps the exit result when the process starts normally", async () => {
    const spawner = new ChildProcessSpawner();
    const child = spawner.spawn(process.execPath, ["-e", "process.exit(3)"], {
      cwd: process.cwd(),
    });

    await expect(child.exited).resolves.toMatchObject({ code: 3 });
  });
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
