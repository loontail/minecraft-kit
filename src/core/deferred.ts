/**
 * Externally-settleable promise. Lets a producer hand the receiver a
 * `Promise<T>` while keeping `resolve` / `reject` available on a sibling
 * code path (e.g. an HTTP request handler or an abort listener).
 *
 * Both `resolve` and `reject` are idempotent: only the first call wins, all
 * later calls are no-ops. Read `settled` to skip work after the promise has
 * already been decided.
 *
 * @internal
 */
export type Deferred<T> = {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
  readonly settled: boolean;
};

/** Construct a fresh {@link Deferred}. @internal */
export const deferred = <T>(): Deferred<T> => {
  let resolveInner!: (value: T) => void;
  let rejectInner!: (reason: unknown) => void;
  let settled = false;
  const promise = new Promise<T>((res, rej) => {
    resolveInner = res;
    rejectInner = rej;
  });
  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      resolveInner(value);
    },
    reject(reason) {
      if (settled) return;
      settled = true;
      rejectInner(reason);
    },
    get settled() {
      return settled;
    },
  };
};
