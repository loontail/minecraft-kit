/**
 * Optional `@clack/prompts` runtime binding. The dependency is declared as optional so
 * library consumers that never touch the CLI do not pull it in; the CLI binary loads it
 * lazily here, with a clear error message when the dependency is missing.
 *
 * @internal
 * @packageDocumentation
 */

/**
 * Minimal contract this module needs from `@clack/prompts`. Declared locally so the file
 * compiles even when `@clack/prompts` is not installed.
 *
 * @internal
 */
export type ClackModule = {
  intro(m: string): void;
  outro(m: string): void;
  note(body: string, title?: string): void;
  log: {
    info(m: string): void;
    success(m: string): void;
    warn(m: string): void;
    error(m: string): void;
  };
  text(opts: object): Promise<unknown>;
  select(opts: object): Promise<unknown>;
  confirm(opts: object): Promise<unknown>;
  spinner(): {
    start(m: string): void;
    stop(m?: string): void;
    message?(m: string): void;
  };
  isCancel(value: unknown): boolean;
};

/**
 * Dynamically import `@clack/prompts`. Throws a user-facing instruction to install it when
 * the optional dependency is missing.
 *
 * @internal
 */
export const loadClackModule = async (): Promise<ClackModule> => {
  try {
    return (await import("@clack/prompts")) as unknown as ClackModule;
  } catch {
    throw new Error(
      "The `mckit` CLI requires the optional dependency `@clack/prompts`. Install it with `npm install @clack/prompts` (or run `npm install` without `--omit=optional`).",
    );
  }
};
