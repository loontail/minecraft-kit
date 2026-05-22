import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";

/**
 * Substitute `${...}` placeholders in a single argument.
 *
 * @internal
 */
export const substituteArg = (raw: string, values: Readonly<Record<string, string>>): string => {
  return raw.replaceAll(/\$\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.INVALID_INPUT,
        `Unknown launch placeholder: ${match}`,
        {
          context: { placeholder: key },
        },
      );
    }
    return value;
  });
};

/**
 * Substitute placeholders in every entry of an arguments list.
 *
 * @internal
 */
export const substituteArgs = (
  args: readonly string[],
  values: Readonly<Record<string, string>>,
): readonly string[] => {
  return args.map((arg) => substituteArg(arg, values));
};
