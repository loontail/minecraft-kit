import type { LibraryRule } from "../types/minecraft";
import type { RuntimeSystem } from "../types/system";

/**
 * Inputs to rule evaluation.
 *
 * @internal
 */
export type RuleEvaluationContext = {
  readonly system: RuntimeSystem;
  readonly features?: Readonly<Record<string, boolean>>;
};

/**
 * Evaluate a list of Mojang library/argument rules against the given context.
 *
 * Algorithm: each rule with a matching `os`/`features` predicate updates a running
 * `allowed` flag (`allow` → true, `disallow` → false). Last matching rule wins.
 * When the rule list is empty, the result is `true`.
 *
 * @internal
 */
export const evaluateRules = (
  rules: readonly LibraryRule[] | undefined,
  context: RuleEvaluationContext,
): boolean => {
  if (!rules || rules.length === 0) {
    return true;
  }
  let allowed = false;
  for (const rule of rules) {
    if (matchesRule(rule, context)) {
      allowed = rule.action === "allow";
    }
  }
  return allowed;
};

const matchesRule = (rule: LibraryRule, context: RuleEvaluationContext): boolean => {
  if (rule.os !== undefined) {
    if (rule.os.name !== undefined && rule.os.name !== context.system.os) {
      return false;
    }
    if (rule.os.arch !== undefined && normalizeArch(rule.os.arch) !== context.system.arch) {
      return false;
    }
    if (rule.os.version !== undefined) {
      try {
        if (!new RegExp(rule.os.version).test(context.system.osVersion)) {
          return false;
        }
      } catch {
        return false;
      }
    }
  }
  if (rule.features !== undefined) {
    const features = context.features ?? {};
    for (const [key, expected] of Object.entries(rule.features)) {
      const actual = features[key] === true;
      if (expected !== actual) {
        return false;
      }
    }
  }
  return true;
};

/**
 * Mojang manifests sometimes use `x86` (32-bit) where Node uses `ia32`. We canonicalize
 * to Mojang names elsewhere and treat `x86` as `x86`.
 */
const normalizeArch = (arch: string): string => {
  return arch === "ia32" ? "x86" : arch;
};

/**
 * Resolve the `${arch}` placeholder used in legacy native classifier names.
 *
 * @internal
 */
export const resolveArchPlaceholder = (template: string, archDigit: string): string => {
  return template.replaceAll("${arch}", archDigit);
};

/**
 * The numeric arch suffix used by legacy LWJGL natives (`x64` → `64`, `x86` → `32`).
 *
 * @internal
 */
export const archDigit = (arch: RuntimeSystem["arch"]): string => {
  if (arch === "x86") return "32";
  if (arch === "x64") return "64";
  return "64";
};
