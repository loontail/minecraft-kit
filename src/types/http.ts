/**
 * Subset of fetch headers the library actually uses.
 */
export type HttpHeaders = Readonly<Record<string, string>>;

/**
 * Response delivered by the {@link HttpClient} interface.
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
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * Body payload accepted on POST requests.
 */
export type HttpRequestBody = string | Uint8Array;

/**
 * Options for an HTTP request.
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
 */
export type HttpClient = {
  request(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
};
