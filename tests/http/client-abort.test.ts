import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FetchHttpClient } from "../../src/http/client";

/** Serves headers plus one chunk, then holds the response open forever. */
const startHalfOpenServer = async (): Promise<{ server: Server; url: string }> => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.write("first");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/body` };
};

const settlementOf = async (promise: Promise<unknown>, withinMs: number): Promise<string> => {
  let timer: NodeJS.Timeout | undefined;
  const pending = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve("pending"), withinMs);
  });
  try {
    return await Promise.race([
      promise.then(
        () => "resolved",
        () => "rejected",
      ),
      pending,
    ]);
  } finally {
    clearTimeout(timer);
  }
};

// The abort forwarding used to be removed the moment response headers arrived, so a caller (or
// `downloadFile`'s per-attempt teardown) that aborted while the body was streaming never reached
// the request: the pending read stayed pending and the body's reader stayed locked forever.
describe("FetchHttpClient — abort during body streaming", () => {
  let server: Server;
  let url: string;

  beforeEach(async () => {
    ({ server, url } = await startHalfOpenServer());
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("tears down a half-open body when the caller signal aborts", async () => {
    const controller = new AbortController();
    const response = await new FetchHttpClient().request(url, { signal: controller.signal });
    let closed = 0;
    const iterator = (async function* consume() {
      try {
        yield* response.stream();
      } finally {
        closed++;
      }
    })();

    const first = await iterator.next();
    expect(new TextDecoder().decode(first.value ?? new Uint8Array())).toBe("first");

    const stalled = iterator.next();
    expect(await settlementOf(stalled, 300)).toBe("pending");

    controller.abort();
    expect(await settlementOf(stalled, 2_000)).toBe("rejected");
    expect(closed).toBe(1);
  }, 10_000);
});
