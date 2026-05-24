import type {
  HttpClient,
  HttpHeaders,
  HttpRequestOptions,
  HttpResponse,
} from "../../src/types/http";

/** A scripted response for {@link FakeHttpClient}. */
export type FakeResponseSpec =
  | {
      readonly status?: number;
      readonly headers?: HttpHeaders;
      readonly body: string | Uint8Array | (() => Uint8Array);
    }
  | {
      /** Throw this error from `request()` instead of returning a response. */
      readonly error: () => Error;
    };

/** Test-only HttpClient that returns scripted responses keyed by URL. */
export class FakeHttpClient implements HttpClient {
  readonly requests: { url: string; options?: HttpRequestOptions }[] = [];
  private readonly responses = new Map<string, FakeResponseSpec>();

  on(url: string, response: FakeResponseSpec): this {
    this.responses.set(url, response);
    return this;
  }

  async request(url: string, options?: HttpRequestOptions): Promise<HttpResponse> {
    this.requests.push({ url, ...(options !== undefined ? { options } : {}) });
    const spec = this.responses.get(url);
    if (!spec) {
      throw new Error(`Unmocked URL: ${url}`);
    }
    if ("error" in spec) {
      throw spec.error();
    }
    const status = spec.status ?? 200;
    const headers = spec.headers ?? {};
    const bodyBytes = toBytes(spec.body);
    return {
      status,
      headers,
      url,
      async text() {
        return new TextDecoder().decode(bodyBytes);
      },
      async json<T = unknown>() {
        return JSON.parse(new TextDecoder().decode(bodyBytes)) as T;
      },
      async bytes() {
        return bodyBytes;
      },
      async *stream() {
        const chunkSize = 4096;
        for (let offset = 0; offset < bodyBytes.length; offset += chunkSize) {
          yield bodyBytes.slice(offset, offset + chunkSize);
        }
      },
    };
  }
}

type BodyOnlySpec = Extract<FakeResponseSpec, { body: unknown }>;

const toBytes = (body: BodyOnlySpec["body"]): Uint8Array => {
  if (typeof body === "function") return body();
  if (typeof body === "string") return new TextEncoder().encode(body);
  return body;
};
