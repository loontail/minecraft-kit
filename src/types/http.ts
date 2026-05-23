/**
 * Subset of fetch headers the library actually uses.
 *
 * @example
 * ```ts
 * import type { HttpHeaders } from "@loontail/minecraft-kit";
 *
 * const headers: HttpHeaders = { authorization: `Bearer ${token}`, accept: "application/json" };
 * await kit["http"]?.request("https://example.com", { headers });
 * ```
 */
export type HttpHeaders = Readonly<Record<string, string>>;

/**
 * Response delivered by the {@link HttpClient} interface.
 *
 * @example
 * ```ts
 * import type { HttpClient, HttpResponse } from "@loontail/minecraft-kit";
 *
 * const fetchManifest = async (http: HttpClient): Promise<unknown> => {
 *   const response: HttpResponse = await http.request("https://example.com/manifest.json");
 *   return response.json();
 * };
 * ```
 */
export type HttpResponse = {
  readonly status: number;
  readonly headers: HttpHeaders;
  readonly url: string;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  bytes(): Promise<Uint8Array>;
  /** Stream the body. The stream may be consumed at most once. */
  stream(): AsyncIterable<Uint8Array>;
};

/**
 * HTTP method supported by {@link HttpClient}.
 *
 * @example
 * ```ts
 * import type { HttpClient, HttpMethod } from "@loontail/minecraft-kit";
 *
 * const request = (http: HttpClient, method: HttpMethod, url: string) =>
 *   http.request(url, { method });
 * ```
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * Body payload accepted on POST requests.
 *
 * @example
 * ```ts
 * import type { HttpClient, HttpRequestBody } from "@loontail/minecraft-kit";
 *
 * const post = (http: HttpClient, url: string, body: HttpRequestBody) =>
 *   http.request(url, { method: "POST", body });
 * ```
 */
export type HttpRequestBody = string | Uint8Array;

/**
 * Options for an HTTP request.
 *
 * @example
 * ```ts
 * import type { HttpClient, HttpRequestOptions } from "@loontail/minecraft-kit";
 *
 * const fetchJson = (http: HttpClient, url: string, signal: AbortSignal) => {
 *   const options: HttpRequestOptions = { signal, timeoutMs: 30_000 };
 *   return http.request(url, options).then((r) => r.json());
 * };
 * ```
 */
export type HttpRequestOptions = {
  readonly headers?: HttpHeaders;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** When true, do not consult the in-memory cache. */
  readonly noCache?: boolean;
  /** HTTP method. Defaults to `GET`. */
  readonly method?: HttpMethod;
  /** Request body. Ignored for GET. */
  readonly body?: HttpRequestBody;
  /**
   * When `true`, the client returns the response even for non-2xx statuses
   * instead of throwing. Useful for callers that must inspect the body of
   * error responses (e.g. OAuth polling endpoints that return 400 with
   * structured JSON like `{"error":"authorization_pending"}`).
   */
  readonly acceptNonOk?: boolean;
};

/**
 * Pluggable HTTP client. The default implementation uses Node's built-in fetch; consumers
 * can inject a fake (e.g. for tests) by passing an `httpClient` to the {@link MinecraftKit}
 * constructor.
 *
 * @example
 * ```ts
 * import { MinecraftKit, type HttpClient } from "@loontail/minecraft-kit";
 *
 * const fakeHttp: HttpClient = {
 *   request: async (url) => ({
 *     status: 200, headers: {}, url, text: async () => "{}", json: async () => ({}),
 *     bytes: async () => new Uint8Array(), stream: async function* () {},
 *   }),
 * };
 * const kit = new MinecraftKit({ httpClient: fakeHttp });
 * ```
 */
export type HttpClient = {
  request(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
};
