/**
 * Return a new array preserving first-occurrence order, keyed by `key(value)`.
 *
 * @internal
 */
export const dedupeBy = <T, K>(values: readonly T[], key: (value: T) => K): readonly T[] => {
  const seen = new Set<K>();
  const result: T[] = [];
  for (const value of values) {
    const k = key(value);
    if (seen.has(k)) continue;
    seen.add(k);
    result.push(value);
  }
  return result;
};

/**
 * Return a new array preserving first-occurrence order, deduplicated by value identity.
 *
 * @internal
 */
export const dedupe = <T>(values: readonly T[]): readonly T[] => {
  return dedupeBy(values, (v) => v);
};
