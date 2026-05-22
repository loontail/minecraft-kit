import type { Logger } from "../types/logger";

/**
 * Minimum Java version that recognises each JVM flag prefix.
 *
 * Sources: `--sun-misc-unsafe-memory-access` (JEP 471/498),
 * `--enable-native-access` (JEP 412 incubator / 454 final),
 * `-XX:+UseCompactObjectHeaders` (JEP 450), `-XX:+UseZGC` (production since Java 15).
 *
 * Matching is by prefix to cover both `--flag=value` and `--flag value` forms.
 */
const FLAG_MIN_JAVA: ReadonlyArray<{ readonly prefix: string; readonly minJava: number }> = [
  { prefix: "--sun-misc-unsafe-memory-access", minJava: 23 },
  { prefix: "--enable-native-access", minJava: 17 },
  { prefix: "-XX:+UseCompactObjectHeaders", minJava: 24 },
  { prefix: "-XX:+UseZGC", minJava: 15 },
];

/** @internal */
export type FilterArgsInput = {
  readonly args: readonly string[];
  readonly javaMajor: number;
  readonly logger?: Logger;
};

/**
 * Drop JVM flags the chosen Java version cannot parse (safety net against pinned newer flags).
 *
 * @internal
 */
export const filterArgsForJava = (input: FilterArgsInput): readonly string[] => {
  if (!Number.isFinite(input.javaMajor) || input.javaMajor <= 0) return input.args;
  const out: string[] = [];
  for (const arg of input.args) {
    const incompatible = FLAG_MIN_JAVA.find(
      ({ prefix }) =>
        arg === prefix || arg.startsWith(`${prefix}=`) || arg.startsWith(`${prefix} `),
    );
    if (incompatible && input.javaMajor < incompatible.minJava) {
      input.logger?.log(
        "warn",
        `Dropping JVM arg "${arg}" — requires Java ${incompatible.minJava}, runtime is Java ${input.javaMajor}`,
        { flag: arg, minJava: incompatible.minJava, runtimeJava: input.javaMajor },
      );
      continue;
    }
    out.push(arg);
  }
  return out;
};
