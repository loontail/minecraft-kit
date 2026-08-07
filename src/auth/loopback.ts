import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { deferred } from "../core/deferred";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import type { Logger } from "../types/logger";

/**
 * Loopback HTTP server that captures a single OAuth callback. The Authorization Code
 * flow asks Microsoft to redirect the user's browser back to a URL we control; on
 * desktop, the cleanest URL is `http://127.0.0.1:<random-port>/`. We start the server
 * before opening the browser and close it the moment the callback fires (success,
 * error, or abort).
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

/**
 * Microsoft's loopback redirect rule: any port is accepted at runtime, but the
 * `host` and `path` are pinned. The registered redirect URI is `http://localhost`;
 * anything else 404s.
 *
 * @internal
 */
const MICROSOFT_LOOPBACK = { host: "127.0.0.1", path: "/" } as const;

/**
 * Base URL handed to the `URL` constructor when parsing `req.url`
 * (which only contains the path + query).
 *
 * @internal
 */
const LOOPBACK_BASE = `http://${MICROSOFT_LOOPBACK.host}` as const;

/**
 * Node defaults `keepAliveTimeout` to 5_000ms and modern browsers hold idle
 * keep-alive sockets for ~60s. Without this drop, `server.close()` blocks for
 * dozens of seconds after the single round-trip the loopback needs.
 *
 * @internal
 */
const LOOPBACK_KEEP_ALIVE_MS = 1_000;

/**
 * Microsoft uses `access_denied` in the `error` query param when the user
 * clicks "cancel" / closes the consent page. Surface that with a distinct
 * kit code so callers can keep the UI quiet.
 *
 * @internal
 */
const MICROSOFT_USER_DECLINED_ERROR = "access_denied" as const;

/**
 * Result of {@link startLoopbackServer}.
 *
 * @internal
 */
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

/**
 * Options for {@link startLoopbackServer}.
 *
 * @internal
 */
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
 * `/?code=…&state=…` request.
 *
 * The server only ever resolves the promise once — subsequent requests on the same
 * server are answered with 410 Gone. This protects against replay if the user opens
 * the callback URL twice (e.g. browser refresh).
 *
 * @internal
 */
export const startLoopbackServer = async (
  options: StartLoopbackServerOptions,
): Promise<LoopbackServer> => {
  const successHtml = options.successHtml ?? DEFAULT_SUCCESS_HTML;
  let closed = false;
  const cap = deferred<{ readonly code: string }>();

  const server: Server = createServer((req, res) => {
    handleRequest(
      req,
      res,
      options.expectedState,
      successHtml,
      {
        onCode: (code) => cap.resolve({ code }),
        onProviderError: (errorCode, description) =>
          cap.reject(buildProviderError(errorCode, description)),
      },
      options.logger,
    );
  });
  server.keepAliveTimeout = LOOPBACK_KEEP_ALIVE_MS;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    const aborted = options.signal?.aborted === true;
    cap.reject(
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
    server.closeAllConnections?.();
    server.closeIdleConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

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
    server.listen(options.port ?? 0, MICROSOFT_LOOPBACK.host);
  });

  const address = server.address() as AddressInfo | null;
  if (address === null || typeof address === "string") {
    await close();
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_AUTHORIZATION_CODE_FAILED,
      "Loopback server did not report a usable bound address.",
    );
  }

  if (options.signal) {
    const onAbort = (): void => {
      void close();
    };
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }

  void cap.promise.catch(() => {});

  return { port: address.port, captured: cap.promise, close };
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
  const url = new URL(req.url, LOOPBACK_BASE);
  if (url.pathname !== MICROSOFT_LOOPBACK.path) {
    logger?.log("debug", `loopback: 404 for path ${url.pathname}`);
    respondText(res, 404, "Not Found");
    return;
  }
  const state = url.searchParams.get("state");
  if (isReplayableStateMismatch(state, expectedState)) {
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

/**
 * Returns true when the request carries a state value that does not match the
 * expected one. We respond 400 and do not settle the capture promise — the
 * legitimate callback (e.g. from a fresh consent page after the user reopened
 * an old tab) can still arrive.
 *
 * @internal
 */
const isReplayableStateMismatch = (state: string | null, expectedState: string): boolean =>
  state !== expectedState;

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
  if (code === MICROSOFT_USER_DECLINED_ERROR) {
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
