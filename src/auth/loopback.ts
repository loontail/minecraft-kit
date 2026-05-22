import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import type { Logger } from "../types/logger";

/**
 * Loopback HTTP server that captures a single OAuth callback. The Authorization Code
 * flow asks Microsoft to redirect the user's browser back to a URL we control; on
 * desktop, the cleanest URL is `http://127.0.0.1:<random-port>/oauth/callback`. We
 * start the server before opening the browser and close it the moment the callback
 * fires (success, error, or abort).
 *
 * Microsoft's "Mobile and desktop applications" platform special-cases `http://localhost`
 * — any port works at runtime without per-port registration.
 */

/** Default HTML body served after a successful capture. Replace via `successHtml`. */
const DEFAULT_SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Sign-in complete</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 3rem; text-align: center; color: #222; }
    h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
    p { color: #666; margin: 0; }
  </style>
</head>
<body>
  <h1>Sign-in complete</h1>
  <p>You can close this tab and return to the launcher.</p>
</body>
</html>`;

// The redirect URI we hand Microsoft is `http://localhost:<port>` — no path.
// Microsoft's loopback rule allows the port to vary but requires the rest of
// the URI to match the registered redirect URI (typically just
// `http://localhost`). Accepting only the root path keeps us strict.
const CALLBACK_PATH = "/";

/** Result of {@link startLoopbackServer}. */
export type LoopbackServer = {
  /** Port the server is bound to. Build the redirect URI from this. */
  readonly port: number;
  /**
   * Resolves with the captured `code` once Microsoft redirects the browser to the
   * loopback URL with a matching `state`. Rejects on `error=…` in the query, mismatched
   * state (after several attempts), or signal abort.
   */
  readonly captured: Promise<{ readonly code: string }>;
  /** Idempotent. Closes the underlying HTTP server if still listening. */
  close(): Promise<void>;
};

/** Options for {@link startLoopbackServer}. */
export type StartLoopbackServerOptions = {
  /** State value that must appear in the callback's `state` query param. */
  readonly expectedState: string;
  /** Port to bind to. `0` (default) asks the OS for a free ephemeral port. */
  readonly port?: number;
  /** Optional HTML body returned on a successful capture. */
  readonly successHtml?: string;
  /** Aborting cancels the capture promise and tears the server down. */
  readonly signal?: AbortSignal;
  /** Optional logger for per-request debug traces (path, state mismatch, capture). */
  readonly logger?: Logger;
};

/**
 * Bind a loopback HTTP server on `127.0.0.1:<port>` and wait for a single
 * `/oauth/callback?code=…&state=…` request.
 *
 * The server only ever resolves the promise once — subsequent requests on the same
 * server are answered with 410 Gone. This protects against replay if the user opens
 * the callback URL twice (e.g. browser refresh).
 */
export const startLoopbackServer = async (
  options: StartLoopbackServerOptions,
): Promise<LoopbackServer> => {
  const successHtml = options.successHtml ?? DEFAULT_SUCCESS_HTML;
  let closed = false;
  let captureSettled = false;
  let resolveCapture: (value: { code: string }) => void;
  let rejectCapture: (reason: unknown) => void;

  const captured = new Promise<{ readonly code: string }>((resolve, reject) => {
    resolveCapture = resolve;
    rejectCapture = reject;
  });

  const server: Server = createServer((req, res) => {
    handleRequest(
      req,
      res,
      options.expectedState,
      successHtml,
      {
        onCode: (code) => {
          if (captureSettled) return;
          captureSettled = true;
          resolveCapture({ code });
        },
        onProviderError: (errorCode, description) => {
          if (captureSettled) return;
          captureSettled = true;
          rejectCapture(buildProviderError(errorCode, description));
        },
      },
      options.logger,
    );
  });
  // Aggressive keep-alive timeout — the kit only needs one round-trip with the
  // browser. Default Node keep-alive (5s) plus the browser's connection-reuse
  // (Chrome/Edge holds idle for ~60s) means `server.close()` blocks for ~60s
  // waiting for the browser to release the socket. Drop to 1s.
  server.keepAliveTimeout = 1_000;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (!captureSettled) {
      captureSettled = true;
      // Distinguish "caller asked us to stop" from "we crashed mid-flight" so
      // UIs can render a quiet cancellation instead of a loud error.
      const aborted = options.signal?.aborted === true;
      rejectCapture(
        aborted
          ? new MinecraftKitError(
              MinecraftKitErrorCodes.AUTH_CANCELLED,
              "Microsoft sign-in cancelled before the user completed it.",
              { context: { reason: options.signal?.reason } },
            )
          : new MinecraftKitError(
              MinecraftKitErrorCodes.AUTH_AUTHORIZATION_CODE_FAILED,
              "Loopback server closed before capturing the OAuth callback.",
            ),
      );
    }
    // Force-close any still-open keep-alive sockets so `close()` doesn't wait
    // for them to drain naturally (which can take dozens of seconds while the
    // browser holds an idle connection).
    server.closeAllConnections?.();
    server.closeIdleConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  // Surface bind errors (EADDRINUSE if the caller pinned a port) as kit errors.
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off("listening", onListening);
      reject(
        new MinecraftKitError(
          MinecraftKitErrorCodes.AUTH_AUTHORIZATION_CODE_FAILED,
          `Failed to bind loopback server: ${err.message}`,
          { cause: err },
        ),
      );
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port ?? 0, "127.0.0.1");
  });

  const address = server.address() as AddressInfo | null;
  if (address === null || typeof address === "string") {
    await close();
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_AUTHORIZATION_CODE_FAILED,
      "Loopback server did not report a usable bound address.",
    );
  }

  // Plumb abort. We swallow the captured rejection because the caller already sees it
  // through the `captured` promise; the close itself is bookkeeping.
  if (options.signal) {
    const onAbort = (): void => {
      void close();
    };
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }

  // Detach captureSettled / closed cleanup once the promise settles so future
  // requests can still be answered (with 410) without bookkeeping noise.
  void captured
    .catch(() => {})
    .finally(() => {
      // Caller decides when to close — flow uses captured then close() in sequence.
    });

  return { port: address.port, captured, close };
};

const handleRequest = (
  req: IncomingMessage,
  res: ServerResponse,
  expectedState: string,
  successHtml: string,
  hooks: {
    onCode: (code: string) => void;
    onProviderError: (code: string, description: string | null) => void;
  },
  logger: Logger | undefined,
): void => {
  logger?.log("debug", `loopback: incoming ${req.method ?? "?"} ${req.url ?? "?"}`);
  if (req.method !== "GET" || req.url === undefined) {
    respondText(res, 405, "Method Not Allowed");
    return;
  }
  // `req.url` is the path+query only; supply a base so URL() parses it.
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname !== CALLBACK_PATH) {
    logger?.log("debug", `loopback: 404 for path ${url.pathname}`);
    respondText(res, 404, "Not Found");
    return;
  }
  const state = url.searchParams.get("state");
  if (state !== expectedState) {
    // State mismatch — reject the request entirely. We do NOT settle the capture
    // promise, since this might be a stale request from a previous flow (e.g. user
    // reopened an old tab); the legitimate callback can still arrive.
    logger?.log(
      "debug",
      `loopback: state mismatch (expected=${expectedState.slice(0, 8)}…, got=${(state ?? "<null>").slice(0, 8)}…)`,
    );
    respondText(res, 400, "Bad Request: state mismatch");
    return;
  }
  const providerError = url.searchParams.get("error");
  if (providerError !== null) {
    const description = url.searchParams.get("error_description");
    logger?.log("debug", `loopback: provider error ${providerError}`);
    hooks.onProviderError(providerError, description);
    respondText(res, 400, `Sign-in failed: ${providerError}`);
    return;
  }
  const code = url.searchParams.get("code");
  if (code === null || code.length === 0) {
    logger?.log("debug", "loopback: callback missing code");
    respondText(res, 400, "Bad Request: missing code");
    return;
  }
  logger?.log("debug", "loopback: captured code, responding success HTML");
  hooks.onCode(code);
  respondHtml(res, 200, successHtml);
};

const respondText = (res: ServerResponse, status: number, body: string): void => {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(body);
};

const respondHtml = (res: ServerResponse, status: number, body: string): void => {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(body);
};

const buildProviderError = (code: string, description: string | null): MinecraftKitError => {
  // Microsoft uses `access_denied` when the user clicks "cancel" / closes the consent
  // page. Surface that with a distinct kit code so callers can keep the UI quiet.
  if (code === "access_denied") {
    return new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_AUTHORIZATION_CODE_DECLINED,
      "The user declined the Microsoft sign-in request.",
      { context: { microsoftError: code, description } },
    );
  }
  return new MinecraftKitError(
    MinecraftKitErrorCodes.AUTH_AUTHORIZATION_CODE_FAILED,
    `Microsoft authorization endpoint returned an error: ${code}${
      description ? ` — ${description}` : ""
    }`,
    { context: { microsoftError: code, description } },
  );
};
