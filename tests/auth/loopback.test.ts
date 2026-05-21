import { describe, expect, it } from "vitest";
import { startLoopbackServer } from "../../src/auth/loopback";
import { isErrorCode } from "../../src/core/errors";

const fetchPath = async (port: number, path: string): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}${path}`);

describe("startLoopbackServer", () => {
  it("captures a /oauth/callback with matching state and returns the code", async () => {
    const server = await startLoopbackServer({ expectedState: "STATE" });
    try {
      expect(server.port).toBeGreaterThan(0);
      const response = await fetchPath(server.port, "/?code=CODE-1&state=STATE");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      const { code } = await server.captured;
      expect(code).toBe("CODE-1");
    } finally {
      await server.close();
    }
  });

  it("rejects mismatched state with 400 and does NOT settle the capture promise", async () => {
    const server = await startLoopbackServer({ expectedState: "EXPECTED" });
    let captured = false;
    server.captured.then(
      () => {
        captured = true;
      },
      () => {
        captured = true;
      },
    );
    try {
      const response = await fetchPath(server.port, "/?code=C&state=WRONG");
      expect(response.status).toBe(400);
      // Give the microtask queue a tick to settle then re-check.
      await new Promise((r) => setTimeout(r, 10));
      expect(captured).toBe(false);

      // A subsequent correctly-stated callback should still work.
      const ok = await fetchPath(server.port, "/?code=GOOD&state=EXPECTED");
      expect(ok.status).toBe(200);
      const { code } = await server.captured;
      expect(code).toBe("GOOD");
    } finally {
      await server.close();
    }
  });

  it("rejects with AUTH_AUTHORIZATION_CODE_DECLINED when Microsoft returns ?error=access_denied", async () => {
    const server = await startLoopbackServer({ expectedState: "S" });
    try {
      const response = await fetchPath(
        server.port,
        "/?error=access_denied&error_description=user+said+no&state=S",
      );
      expect(response.status).toBe(400);
      try {
        await server.captured;
        expect.fail("expected capture promise to reject");
      } catch (error) {
        expect(isErrorCode(error, "AUTH_AUTHORIZATION_CODE_DECLINED")).toBe(true);
      }
    } finally {
      await server.close();
    }
  });

  it("returns 404 for paths other than the root callback path", async () => {
    const server = await startLoopbackServer({ expectedState: "S" });
    try {
      const response = await fetchPath(server.port, "/other?state=S&code=X");
      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("close() is idempotent and unblocks pending capture", async () => {
    const server = await startLoopbackServer({ expectedState: "S" });
    const capture = server.captured.then(
      () => "resolved",
      (e: unknown) =>
        isErrorCode(e, "AUTH_AUTHORIZATION_CODE_FAILED") ? "rejected-as-failed" : "rejected-other",
    );
    await server.close();
    // Calling again is safe.
    await server.close();
    const outcome = await capture;
    expect(outcome).toBe("rejected-as-failed");
  });

  it("signal abort tears the server down and reports AUTH_CANCELLED", async () => {
    const controller = new AbortController();
    const server = await startLoopbackServer({
      expectedState: "S",
      signal: controller.signal,
    });
    const port = server.port;
    controller.abort();
    // Capture should reject with AUTH_CANCELLED — caller asked to stop.
    try {
      await server.captured;
      expect.fail("expected capture to reject");
    } catch (error) {
      expect(isErrorCode(error, "AUTH_CANCELLED")).toBe(true);
    }
    // Give close() a tick to actually detach the listener before we probe the port.
    await new Promise((r) => setTimeout(r, 20));
    // After close, fetching the now-unbound port should fail at the connection layer.
    let connectionFailed = false;
    try {
      await fetch(`http://127.0.0.1:${port}/?code=X&state=S`);
    } catch {
      connectionFailed = true;
    }
    expect(connectionFailed).toBe(true);
  });
});
