import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPAWNER_MAX_LINE_BYTES } from "../../src/constants/defaults";
import { ChildProcessSpawner } from "../../src/launch/spawner";
import type { SpawnedProcess } from "../../src/types/spawner";

type FakeChild = {
  readonly stdout: PassThrough | null;
  readonly stderr: PassThrough | null;
  readonly killed: (NodeJS.Signals | undefined)[];
  readonly killResult: boolean;
};

/**
 * Spawn a scripted child so the line splitter can be driven byte by byte. The real
 * `ChildProcessSpawner` is the unit under test — only `child_process.spawn` is replaced.
 */
const spawnWithFakeChild = async (
  options: {
    readonly withStdout?: boolean;
    readonly withStderr?: boolean;
    readonly pid?: number | undefined;
    readonly killResult?: boolean;
  } = {},
): Promise<{ readonly process: SpawnedProcess; readonly child: FakeChild }> => {
  const { spawn } = await import("node:child_process");
  const stdout = options.withStdout === false ? null : new PassThrough();
  const stderr = options.withStderr === false ? null : new PassThrough();
  const killed: (NodeJS.Signals | undefined)[] = [];
  const killResult = options.killResult ?? true;
  const emitter = Object.assign(new (await import("node:events")).EventEmitter(), {
    stdout,
    stderr,
    pid: options.pid,
    kill(signal?: NodeJS.Signals): boolean {
      killed.push(signal);
      return killResult;
    },
  });
  vi.mocked(spawn).mockReturnValueOnce(emitter as never);
  const process_ = new ChildProcessSpawner().spawn("/bin/java", ["-version"], { cwd: "/tmp" });
  return { process: process_, child: { stdout, stderr, killed, killResult } };
};

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("ChildProcessSpawner line buffering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("splits on newlines across chunk boundaries and strips CR", async () => {
    const { process: child, child: fake } = await spawnWithFakeChild();
    const lines: string[] = [];
    child.stdout.on("data", (line) => lines.push(line));

    fake.stdout?.write("first\r\nsec");
    fake.stdout?.write("ond\nthird");
    await flush();

    // `third` has no newline yet, so it must still be buffered — emitting it early would let a
    // log parser see a truncated line.
    expect(lines).toEqual(["first", "second"]);

    fake.stdout?.end();
    await flush();
    expect(lines).toEqual(["first", "second", "third"]);
  });

  it("keeps stdout and stderr separate", async () => {
    const { process: child, child: fake } = await spawnWithFakeChild();
    const out: string[] = [];
    const err: string[] = [];
    child.stdout.on("data", (line) => out.push(line));
    child.stderr.on("data", (line) => err.push(line));

    fake.stdout?.write("game\n");
    fake.stderr?.write("crash\n");
    await flush();

    expect(out).toEqual(["game"]);
    expect(err).toEqual(["crash"]);
  });

  it("chunks a single line longer than the cap instead of emitting it whole", async () => {
    const { process: child, child: fake } = await spawnWithFakeChild();
    const lines: string[] = [];
    child.stdout.on("data", (line) => lines.push(line));

    fake.stdout?.write(`${"a".repeat(SPAWNER_MAX_LINE_BYTES + 10)}\n`);
    await flush();

    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(SPAWNER_MAX_LINE_BYTES);
    expect(lines[1]).toHaveLength(10);
  });

  // Without the no-newline overflow flush, a child printing one unterminated multi-megabyte line
  // grows the internal buffer without bound.
  it("flushes an unterminated line that outgrows the cap", async () => {
    const { process: child, child: fake } = await spawnWithFakeChild();
    const lines: string[] = [];
    child.stdout.on("data", (line) => lines.push(line));

    fake.stdout?.write("b".repeat(SPAWNER_MAX_LINE_BYTES * 2 + 5));
    await flush();

    expect(lines).toEqual(["b".repeat(SPAWNER_MAX_LINE_BYTES), "b".repeat(SPAWNER_MAX_LINE_BYTES)]);

    fake.stdout?.end();
    await flush();
    expect(lines).toHaveLength(3);
    expect(lines[2]).toHaveLength(5);
  });

  it("decodes Buffer and string chunks alike", async () => {
    const { process: child, child: fake } = await spawnWithFakeChild();
    const lines: string[] = [];
    child.stdout.on("data", (line) => lines.push(line));

    fake.stdout?.write(Buffer.from("buffered\n", "utf8"));
    await flush();

    expect(lines).toEqual(["buffered"]);
  });

  // A caller that keeps the ProcessStream must not keep its listener closures alive for the
  // lifetime of the host process.
  it("drops subscribers once the producer ends", async () => {
    const { process: child, child: fake } = await spawnWithFakeChild();
    const lines: string[] = [];
    child.stdout.on("data", (line) => lines.push(line));

    fake.stdout?.end("last\n");
    await flush();
    expect(lines).toEqual(["last"]);

    fake.stdout?.emit("data", "after-end\n");
    await flush();
    expect(lines).toEqual(["last"]);
  });

  it("emits nothing when the child has no stdio pipes", async () => {
    const { process: child } = await spawnWithFakeChild({ withStdout: false, withStderr: false });
    const lines: string[] = [];

    expect(() => child.stdout.on("data", (line) => lines.push(line))).not.toThrow();
    expect(() => child.stderr.on("data", (line) => lines.push(line))).not.toThrow();
    expect(lines).toEqual([]);
  });

  it("reports -1 when the child never got a pid, and forwards kill()", async () => {
    const { process: child, child: fake } = await spawnWithFakeChild({ pid: undefined });

    expect(child.pid).toBe(-1);
    expect(child.kill("SIGKILL")).toBe(true);
    expect(fake.killed).toEqual(["SIGKILL"]);
  });

  it("propagates a failed kill", async () => {
    const { process: child } = await spawnWithFakeChild({ killResult: false });

    expect(child.kill("SIGTERM")).toBe(false);
  });
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
