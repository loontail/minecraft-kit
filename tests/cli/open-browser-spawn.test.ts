import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openBrowser } from "../../src/cli/open-browser";

const URL_WITH_AMPERSANDS = "https://login.microsoftonline.com/authorize?client_id=c&scope=s";

type FakeChild = EventEmitter & { unref: () => void };

const fakeChild = (): FakeChild =>
  Object.assign(new EventEmitter(), {
    unref: () => {},
  });

const spawnMock = async () => vi.mocked((await import("node:child_process")).spawn);

describe("openBrowser spawn outcomes", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("resolves true once the child actually starts", async () => {
    const child = fakeChild();
    (await spawnMock()).mockReturnValueOnce(child as never);

    const pending = openBrowser(URL_WITH_AMPERSANDS);
    child.emit("spawn");

    expect(await pending).toBe(true);
  });

  // Resolving on `setImmediate` instead of the 'spawn' event used to report success for a command
  // that immediately ENOENT'd, so the CLI never printed the URL the user needed.
  it("resolves false when the command cannot be started", async () => {
    const child = fakeChild();
    (await spawnMock()).mockReturnValueOnce(child as never);

    const pending = openBrowser(URL_WITH_AMPERSANDS);
    child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));

    expect(await pending).toBe(false);
  });

  it("ignores a late second event instead of settling twice", async () => {
    const child = fakeChild();
    (await spawnMock()).mockReturnValueOnce(child as never);

    const pending = openBrowser(URL_WITH_AMPERSANDS);
    child.emit("spawn");
    child.emit("error", new Error("too late"));

    expect(await pending).toBe(true);
  });

  it("resolves false on the safety-net deadline when neither event fires", async () => {
    vi.useFakeTimers();
    (await spawnMock()).mockReturnValueOnce(fakeChild() as never);

    const pending = openBrowser(URL_WITH_AMPERSANDS);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(await pending).toBe(false);
  });

  it("resolves false when spawn throws synchronously", async () => {
    (await spawnMock()).mockImplementationOnce(() => {
      throw new Error("EMFILE");
    });

    expect(await openBrowser(URL_WITH_AMPERSANDS)).toBe(false);
  });

  it("passes the URL through as a single argument, ampersands intact", async () => {
    const child = fakeChild();
    const spawn = await spawnMock();
    spawn.mockReturnValueOnce(child as never);

    const pending = openBrowser(URL_WITH_AMPERSANDS);
    child.emit("spawn");
    await pending;

    const call = spawn.mock.calls[0];
    expect(call?.[1]).toContain(URL_WITH_AMPERSANDS);
    expect(call?.[2]).toMatchObject({ detached: true, stdio: "ignore", windowsHide: true });
  });

  it("never spawns for a rejected scheme", async () => {
    const spawn = await spawnMock();

    expect(await openBrowser("file:///etc/passwd")).toBe(false);

    expect(spawn).not.toHaveBeenCalled();
  });
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
