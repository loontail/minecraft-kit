/**
 * `true` when `status` is in the HTTP 2xx success range (`200 <= status < 300`).
 *
 * @internal
 */
export const isHttpOk = (status: number): boolean => status >= 200 && status < 300;
