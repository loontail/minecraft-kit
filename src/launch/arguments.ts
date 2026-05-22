import { evaluateRules } from "../core/rules";
import type { ArgumentEntry, MinecraftArguments } from "../types/minecraft";
import type { RuntimeSystem } from "../types/system";

/**
 * Flatten a modern `arguments.{game|jvm}` array, evaluating rules.
 *
 * @internal
 */
export const flattenArguments = (
  entries: readonly ArgumentEntry[],
  context: {
    readonly system: RuntimeSystem;
    readonly features?: Readonly<Record<string, boolean>>;
  },
): readonly string[] => {
  const result: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      result.push(entry);
      continue;
    }
    if (!evaluateRules(entry.rules, context)) continue;
    if (typeof entry.value === "string") {
      result.push(entry.value);
    } else {
      result.push(...entry.value);
    }
  }
  return result;
};

/**
 * Split a legacy minecraftArguments string into an array.
 *
 * @internal
 */
export const splitLegacyArguments = (raw: string): readonly string[] => {
  return raw.trim().length === 0 ? [] : raw.trim().split(/\s+/);
};

/**
 * Convenience: pull both game and jvm arrays from a modern arguments object.
 *
 * @internal
 */
export const pickArguments = (
  args: MinecraftArguments | undefined,
  context: {
    readonly system: RuntimeSystem;
    readonly features?: Readonly<Record<string, boolean>>;
  },
): { readonly game: readonly string[]; readonly jvm: readonly string[] } => {
  return {
    game: flattenArguments(args?.game ?? [], context),
    jvm: flattenArguments(args?.jvm ?? [], context),
  };
};
