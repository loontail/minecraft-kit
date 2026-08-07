import { HTTP_TIMEOUT_MS, USER_AGENT } from "../constants/defaults";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import type { HttpClient, HttpHeaders, HttpRequestOptions, HttpResponse } from "../types/http";

/** Sentinel used as the abort reason when our internal timer fires. */
const TIMEOUT_REASON = Symbol("http-timeout");

/**
 * Default {@link HttpClient} implementation backed by Node's built-in `fetch` (undici under
 * the hood). Maps fetch errors to {@link MinecraftKitError}.
 *
 * @example
 * ```ts
 * import { FetchHttpClient, MinecraftKit } from "@loontail/minecraft-kit";
 *
 * // Explicit instantiation — equivalent to leaving `httpClient` unset.
 * const kit = new MinecraftKit({ httpClient: new FetchHttpClient() });
 * ```
 */
export class FetchHttpClient implements HttpClient {
  async request(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS;
    const onParentAbort = (): void => controller.abort(options.signal?.reason);
    const stopForwardingAbort = (): void =>
      options.signal?.removeEventListener("abort", onParentAbort);
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        options.signal.addEventListener("abort", onParentAbort, { once: true });
      }
    }
    const timer = setTimeout(() => controller.abort(TIMEOUT_REASON), timeoutMs);
    let response: Response;
    const method = options.method ?? "GET";
    try {
      const init: {
        method: string;
        headers: Record<string, string>;
        signal: AbortSignal;
        redirect: "follow";
        body?: string | Uint8Array;
      } = {
        method,
        headers: { "user-agent": USER_AGENT, ...(options.headers ?? {}) },
        signal: controller.signal,
        redirect: "follow",
      };
      if (method !== "GET" && options.body !== undefined) {
        init.body = options.body;
      }
      response = await fetch(url, init);
    } catch (cause) {
      stopForwardingAbort();
      if (controller.signal.reason === TIMEOUT_REASON) {
        throw new MinecraftKitError(
          MinecraftKitErrorCodes.NETWORK_TIMEOUT,
          `Request timed out: ${url}`,
          {
            cause,
            context: { url, timeoutMs },
          },
        );
      }
      if (options.signal?.aborted) {
        throw new MinecraftKitError(
          MinecraftKitErrorCodes.NETWORK_ABORTED,
          `Request aborted: ${url}`,
          {
            cause,
            context: { url },
          },
        );
      }
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.NETWORK_HTTP_ERROR,
        `Network request failed: ${url}`,
        {
          cause,
          context: { url },
        },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok && options.acceptNonOk !== true) {
      stopForwardingAbort();
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.NETWORK_HTTP_ERROR,
        `HTTP ${response.status} for ${url}`,
        {
          context: { url, httpStatus: response.status },
        },
      );
    }
    // why: the caller-signal -> request abort forwarding has to outlive this call. Headers arriving
    // is not the end of the request: an abort raised while the body streams — a cancelled install,
    // or `downloadFile`'s per-attempt teardown after an idle deadline — must still reach fetch, or
    // the body stays half-open with its reader locked and the connection pinned. The response owns
    // the teardown from here and drops the listener once the body is consumed or abandoned.
    return new FetchHttpResponse(response, url, stopForwardingAbort);
  }
}

class FetchHttpResponse implements HttpResponse {
  readonly status: number;
  readonly headers: HttpHeaders;
  readonly url: string;

  constructor(
    private readonly response: Response,
    url: string,
    /** Drops the caller-signal -> request abort forwarding; called once the body is done with. */
    private readonly stopForwardingAbort: () => void,
  ) {
    this.status = response.status;
    this.url = response.url !== "" ? response.url : url;
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    this.headers = headers;
  }

  async text(): Promise<string> {
    try {
      return await this.response.text();
    } finally {
      this.stopForwardingAbort();
    }
  }

  // why the wrap: every other failure in this class leaves as a MinecraftKitError, so a
  // caller can branch on a code. A malformed response body was the one exception — the
  // platform's SyntaxError escaped unwrapped, reached the consumer as an unclassified
  // error, and rendered as a generic failure with no actionable text and no repair
  // offer. This is the path METADATA_PARSE_ERROR was registered and documented for.
  async json<T = unknown>(): Promise<T> {
    try {
      return (await this.response.json()) as T;
    } catch (cause) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.METADATA_PARSE_ERROR,
        `Response body is not valid JSON: ${this.url}`,
        { cause, context: { url: this.url, status: this.response.status } },
      );
    } finally {
      this.stopForwardingAbort();
    }
  }

  async bytes(): Promise<Uint8Array> {
    try {
      const buf = await this.response.arrayBuffer();
      return new Uint8Array(buf);
    } finally {
      this.stopForwardingAbort();
    }
  }

  async *stream(): AsyncIterable<Uint8Array> {
    const body = this.response.body;
    if (!body) {
      const buf = await this.bytes();
      yield buf;
      return;
    }
    const reader = body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        if (value) yield value;
      }
    } finally {
      reader.releaseLock();
      this.stopForwardingAbort();
    }
  }
}
