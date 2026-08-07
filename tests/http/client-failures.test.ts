import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../../src/core/errors";
import { FetchHttpClient } from "../../src/http/client";

type Handler = (request: {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}) => {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body: string;
};

type Harness = {
  readonly url: (path: string) => string;
  readonly serve: (handler: Handler) => void;
  /** Requests the server actually received, in order. */
  readonly received: { method: string; url: string; body: string }[];
  /** Suspends the response for `path` until `release()` is called. */
  readonly stall: (path: string) => void;
  readonly release: () => void;
};

const startServer = async (): Promise<{ server: Server; harness: Harness }> => {
  let handler: Handler = () => ({ body: "ok" });
  const stalled = new Set<string>();
  const held: (() => void)[] = [];
  const received: { method: string; url: string; body: string }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = request.url ?? "/";
      received.push({ method: request.method ?? "GET", url, body });
      if (stalled.has(url)) {
        held.push(() => {
          response.writeHead(200, { "content-type": "text/plain" });
          response.end("late");
        });
        return;
      }
      const result = handler({ url, method: request.method ?? "GET", body });
      response.writeHead(result.status ?? 200, {
        "content-type": "text/plain",
        ...(result.headers ?? {}),
      });
      response.end(result.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    harness: {
      url: (path) => `http://127.0.0.1:${port}${path}`,
      serve: (next) => {
        handler = next;
      },
      received,
      stall: (path) => stalled.add(path),
      release: () => {
        for (const send of held.splice(0)) send();
      },
    },
  };
};

/** A port nothing listens on, so `fetch` fails with ECONNREFUSED. */
const closedPortUrl = async (): Promise<string> => {
  const { server } = await startServer();
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}/gone`;
};

describe("FetchHttpClient failure mapping", () => {
  let server: Server;
  let harness: Harness;

  beforeEach(async () => {
    ({ server, harness } = await startServer());
  });

  afterEach(async () => {
    harness.release();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("throws NETWORK_HTTP_ERROR carrying the status for a non-2xx", async () => {
    harness.serve(() => ({ status: 503, body: "upstream down" }));

    const failure = await new FetchHttpClient()
      .request(harness.url("/down"))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MinecraftKitError);
    expect((failure as MinecraftKitError).code).toBe(MinecraftKitErrorCodes.NETWORK_HTTP_ERROR);
    expect((failure as MinecraftKitError).context).toMatchObject({ httpStatus: 503 });
    expect((failure as MinecraftKitError).message).toContain("HTTP 503");
  });

  it("returns the response body for a non-2xx when acceptNonOk is set", async () => {
    harness.serve(() => ({ status: 404, body: '{"error":"nope"}' }));

    const response = await new FetchHttpClient().request(harness.url("/missing"), {
      acceptNonOk: true,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "nope" });
  });

  it("maps a refused connection to NETWORK_HTTP_ERROR, not a timeout", async () => {
    const failure = await new FetchHttpClient()
      .request(await closedPortUrl())
      .catch((error: unknown) => error);

    expect((failure as MinecraftKitError).code).toBe(MinecraftKitErrorCodes.NETWORK_HTTP_ERROR);
    expect((failure as MinecraftKitError).context).toMatchObject({ url: expect.any(String) });
    expect((failure as MinecraftKitError).cause).toBeDefined();
  });

  it("maps its own deadline to NETWORK_TIMEOUT with the timeout in context", async () => {
    harness.stall("/slow");

    const failure = await new FetchHttpClient()
      .request(harness.url("/slow"), { timeoutMs: 50 })
      .catch((error: unknown) => error);

    expect((failure as MinecraftKitError).code).toBe(MinecraftKitErrorCodes.NETWORK_TIMEOUT);
    expect((failure as MinecraftKitError).context).toMatchObject({ timeoutMs: 50 });
  });

  // A caller abort and the client's own deadline both surface as a fetch AbortError; only the
  // reason sentinel distinguishes them, and a consumer's retry loop branches on the code.
  it("maps a caller abort to NETWORK_ABORTED, distinct from its own timeout", async () => {
    harness.stall("/cancelled");
    const controller = new AbortController();
    const pending = new FetchHttpClient()
      .request(harness.url("/cancelled"), { signal: controller.signal, timeoutMs: 10_000 })
      .catch((error: unknown) => error);
    controller.abort();

    expect(((await pending) as MinecraftKitError).code).toBe(
      MinecraftKitErrorCodes.NETWORK_ABORTED,
    );
  });

  it("rejects immediately when the caller signal is already aborted", async () => {
    const failure = await new FetchHttpClient()
      .request(harness.url("/never"), { signal: AbortSignal.abort("gone") })
      .catch((error: unknown) => error);

    expect((failure as MinecraftKitError).code).toBe(MinecraftKitErrorCodes.NETWORK_ABORTED);
    expect(harness.received).toEqual([]);
  });
});

describe("FetchHttpClient request shaping", () => {
  let server: Server;
  let harness: Harness;

  beforeEach(async () => {
    ({ server, harness } = await startServer());
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("sends a body for a POST and lower-cases response header names", async () => {
    harness.serve(({ body }) => ({ headers: { "X-Echo-Length": String(body.length) }, body }));

    const response = await new FetchHttpClient().request(harness.url("/post"), {
      method: "POST",
      body: "grant_type=refresh_token",
    });

    expect(await response.text()).toBe("grant_type=refresh_token");
    expect(response.headers["x-echo-length"]).toBe("24");
    expect(harness.received[0]).toMatchObject({ method: "POST" });
  });

  it("drops a body on a GET rather than sending an illegal request", async () => {
    const response = await new FetchHttpClient().request(harness.url("/get"), {
      body: "ignored",
    });

    expect(response.status).toBe(200);
    expect(harness.received[0]?.body).toBe("");
  });

  it("reports the final URL after a redirect", async () => {
    harness.serve(({ url }) =>
      url === "/from"
        ? { status: 302, headers: { location: "/to" }, body: "" }
        : { body: "arrived" },
    );

    const response = await new FetchHttpClient().request(harness.url("/from"));

    expect(await response.text()).toBe("arrived");
    expect(response.url).toBe(harness.url("/to"));
    expect(harness.received.map((r) => r.url)).toEqual(["/from", "/to"]);
  });

  it("streams a body in chunks and yields the whole payload", async () => {
    const payload = "x".repeat(9_000);
    harness.serve(() => ({ body: payload }));

    const response = await new FetchHttpClient().request(harness.url("/stream"));
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.stream()) chunks.push(chunk);

    expect(Buffer.concat(chunks).toString("utf8")).toBe(payload);
  });

  it("exposes the payload as bytes", async () => {
    harness.serve(() => ({ body: "bytes" }));

    const response = await new FetchHttpClient().request(harness.url("/bytes"));

    expect(new TextDecoder().decode(await response.bytes())).toBe("bytes");
  });

  // why this matters beyond tidiness: every other failure in FetchHttpClient leaves as a
  // MinecraftKitError, so a consumer can branch on the code and offer a repair. A bad
  // JSON body used to escape as the platform's own SyntaxError, reach the launcher
  // unclassified, and render as a generic failure with no actionable text.
  it("wraps a malformed JSON body as METADATA_PARSE_ERROR, not a bare SyntaxError", async () => {
    harness.serve(() => ({
      headers: { "content-type": "application/json" },
      body: "<html>gateway timeout</html>",
    }));

    const response = await new FetchHttpClient().request(harness.url("/manifest.json"));
    const failure = await response.json().then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(failure).toBeInstanceOf(MinecraftKitError);
    expect((failure as MinecraftKitError).code).toBe(MinecraftKitErrorCodes.METADATA_PARSE_ERROR);
    expect((failure as MinecraftKitError).context).toMatchObject({
      url: harness.url("/manifest.json"),
      status: 200,
    });
  });
});
