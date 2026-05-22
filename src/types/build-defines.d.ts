/**
 * Build-time string replacements injected by tsup `define`.
 *
 * These constants are inlined at bundle time; reading them at runtime in a
 * non-bundled context (e.g. tests) requires vitest to mirror the same
 * `define` so the symbol resolves to a real value.
 *
 * @internal
 */

declare const __PKG_VERSION__: string;
