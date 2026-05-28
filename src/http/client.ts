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
      options.signal?.removeEventListener("abort", onParentAbort);
    }
    if (!response.ok && options.acceptNonOk !== true) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.NETWORK_HTTP_ERROR,
        `HTTP ${response.status} for ${url}`,
        {
          context: { url, httpStatus: response.status },
        },
      );
    }
    return new FetchHttpResponse(response, url);
  }
}

class FetchHttpResponse implements HttpResponse {
  readonly status: number;
  readonly headers: HttpHeaders;
  readonly url: string;

  constructor(
    private readonly response: Response,
    url: string,
  ) {
    this.status = response.status;
    this.url = url;
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    this.headers = headers;
  }

  async text(): Promise<string> {
    return this.response.text();
  }

  async json<T = unknown>(): Promise<T> {
    return (await this.response.json()) as T;
  }

  async bytes(): Promise<Uint8Array> {
    const buf = await this.response.arrayBuffer();
    return new Uint8Array(buf);
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
    }
  }
}
