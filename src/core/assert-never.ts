/**
 * Exhaustiveness sentinel for discriminated unions. Drop into the `default` of a switch on
 * `kind` / `type` / `status` so the compiler errors when a new variant is added but the
 * switch is not updated.
 *
 * @example
 * ```ts
 * import { assertNever, InstallActionKinds, type InstallAction } from "@loontail/minecraft-kit";
 *
 * function describe(action: InstallAction): string {
 *   switch (action.kind) {
 *     case InstallActionKinds.DOWNLOAD_FILE: return `download ${action.target}`;
 *     case InstallActionKinds.EXTRACT_NATIVE: return `extract ${action.source}`;
 *     case InstallActionKinds.WRITE_VERSION_JSON: return `write ${action.target}`;
 *     case InstallActionKinds.WRITE_LOGGING_CONFIG: return `write ${action.target}`;
 *     case InstallActionKinds.RUN_FORGE_PROCESSOR: return `processor ${action.processor.jar}`;
 *     default: return assertNever(action);
 *   }
 * }
 * ```
 */
export const assertNever = (value: never): never => {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
};
