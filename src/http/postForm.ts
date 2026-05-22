import { withOptionalSignal } from "../core/optional";
import type { HttpClient } from "../types/http";

/**
 * POST a `URLSearchParams` body to `url` as `application/x-www-form-urlencoded`, accepting
 * non-2xx responses (the caller decides how to interpret them) and returning the parsed
 * JSON body alongside the status code.
 *
 * @internal
 */
export const postFormUrlEncoded = async (
  http: HttpClient,
  url: string,
  body: URLSearchParams,
  signal: AbortSignal | undefined,
): Promise<{ readonly status: number; readonly json: unknown }> => {
  const response = await http.request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString(),
    acceptNonOk: true,
    ...withOptionalSignal(signal),
  });
  const json: unknown = await response.json().catch(() => ({}));
  return { status: response.status, json };
};
