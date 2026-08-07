import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { USER_AGENT } from "../../src/constants/defaults";
import { FetchHttpClient } from "../../src/http/client";

/** Echoes the request's `user-agent` back as the response body. */
const startEchoServer = async (): Promise<{ server: Server; url: string }> => {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(request.headers["user-agent"] ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/` };
};

// KITH-P24: the constant read `minecraft-kit/0.1` at package version 0.8.14, so every request to
// Mojang/Fabric/Forge advertised a version that had not existed for eight minor releases.
describe("outgoing user-agent", () => {
  let server: Server;
  let url: string;

  beforeEach(async () => {
    ({ server, url } = await startEchoServer());
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("carries the real package version", () => {
    expect(USER_AGENT).toMatch(/^minecraft-kit\/\d+\.\d+\.\d+/);
  });

  it("is sent on every request", async () => {
    const response = await new FetchHttpClient().request(url);

    expect(await response.text()).toBe(USER_AGENT);
  });

  it("yields to a caller-supplied user-agent", async () => {
    const response = await new FetchHttpClient().request(url, {
      headers: { "user-agent": "custom/1.0" },
    });

    expect(await response.text()).toBe("custom/1.0");
  });
});
