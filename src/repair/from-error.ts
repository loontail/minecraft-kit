import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { withOptionalSignal } from "../core/optional";
import { targetPaths } from "../core/paths";
import { planInstall } from "../install/planner";
import type { MetadataCache } from "../types/cache";
import type { MinecraftKitErrorCode } from "../types/errors";
import type { HttpClient } from "../types/http";
import {
  type DownloadAction,
  DownloadCategories,
  type InstallAction,
  InstallActionKinds,
  type InstallPlan,
} from "../types/install";
import { Loaders } from "../types/loader";
import type { RepairFromErrorInput, RepairPlan } from "../types/repair";
import { buildRepairPlan } from "./helpers";

/**
 * Error codes from which {@link planRepairFromError} can derive a focused repair plan.
 *
 * Adding a new entry here is non-breaking. Removing or relaxing one is breaking — callers
 * may have written narrow `catch` blocks that rely on `INVALID_INPUT` for the unsupported
 * codes.
 *
 * @internal
 */
export const RepairFromErrorSupportedCodes = {
  INTEGRITY_HASH_MISMATCH: MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH,
  INTEGRITY_SIZE_MISMATCH: MinecraftKitErrorCodes.INTEGRITY_SIZE_MISMATCH,
  FILESYSTEM_WRITE_ERROR: MinecraftKitErrorCodes.FILESYSTEM_WRITE_ERROR,
  NETWORK_HTTP_ERROR: MinecraftKitErrorCodes.NETWORK_HTTP_ERROR,
  NETWORK_TIMEOUT: MinecraftKitErrorCodes.NETWORK_TIMEOUT,
  FORGE_PROCESSOR_FAILED: MinecraftKitErrorCodes.FORGE_PROCESSOR_FAILED,
} as const;

/**
 * Union of error codes supported by {@link planRepairFromError}.
 *
 * @internal
 */
export type RepairFromErrorSupportedCode =
  (typeof RepairFromErrorSupportedCodes)[keyof typeof RepairFromErrorSupportedCodes];

/**
 * Inputs to the standalone {@link planRepairFromError}. Adds the `http` / `cache` DI bundle
 * that `kit.repair.fromError` supplies automatically.
 *
 * @internal
 */
export type PlanRepairFromErrorInput = RepairFromErrorInput & {
  readonly http: HttpClient;
  readonly cache: MetadataCache;
};

/**
 * Derive a minimal {@link RepairPlan} from a typed {@link MinecraftKitError} thrown by a
 * previous install / repair run. The plan re-uses the standard install actions for the
 * artefacts named in `error.context` — no full verify sweep, no manual issue
 * reconstruction.
 *
 * Supported codes are listed in {@link RepairFromErrorSupportedCodes}. For any other code
 * the function throws `INVALID_INPUT` with a message naming the unsupported code; the
 * regular `verify → plan → run` flow is the correct fallback there.
 *
 * Prefer `kit.repair.fromError({ error, target })` over importing this directly.
 *
 * @internal
 */
export const planRepairFromError = async (input: PlanRepairFromErrorInput): Promise<RepairPlan> => {
  const { error, target, http, cache, signal } = input;
  assertSupportedCode(error.code);
  const installPlan = await planInstall({
    target,
    http,
    cache,
    ...withOptionalSignal(signal),
  });
  const actions = deriveRepairActionsFromError(error, installPlan);
  if (actions.length === 0) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `Cannot derive repair from ${error.code}: no install action matches the error context`,
      { context: { code: error.code, errorContext: error.context } },
    );
  }
  return buildRepairPlan(target, actions);
};

const assertSupportedCode: (
  code: MinecraftKitErrorCode,
) => asserts code is RepairFromErrorSupportedCode = (code) => {
  if (!isSupportedCode(code)) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `Cannot derive repair from non-repairable error code: ${code}`,
      { context: { code } },
    );
  }
};

const isSupportedCode = (code: MinecraftKitErrorCode): code is RepairFromErrorSupportedCode => {
  const supported: readonly MinecraftKitErrorCode[] = Object.values(RepairFromErrorSupportedCodes);
  return supported.includes(code);
};

/**
 * Pure mapper from `(error, installPlan)` → repair actions. Exposed for unit-tests that
 * synthesise an `InstallPlan` directly instead of running the full planner.
 *
 * @internal
 */
export const deriveRepairActionsFromError = (
  error: {
    readonly code: MinecraftKitErrorCode;
    readonly context: Readonly<Record<string, unknown>>;
  },
  installPlan: InstallPlan,
): InstallAction[] => {
  switch (error.code) {
    case RepairFromErrorSupportedCodes.INTEGRITY_HASH_MISMATCH:
    case RepairFromErrorSupportedCodes.INTEGRITY_SIZE_MISMATCH:
    case RepairFromErrorSupportedCodes.NETWORK_TIMEOUT:
      return findActionsByErrorUrls(installPlan, collectErrorUrls(error.context));
    case RepairFromErrorSupportedCodes.NETWORK_HTTP_ERROR:
      return findActionsByErrorUrlsOrPath(installPlan, error.context);
    case RepairFromErrorSupportedCodes.FILESYSTEM_WRITE_ERROR:
      return findActionsByErrorUrlsOrPath(installPlan, error.context);
    case RepairFromErrorSupportedCodes.FORGE_PROCESSOR_FAILED:
      return collectForgeProcessorStage(installPlan);
    default:
      return [];
  }
};

/**
 * Read `context.url` (always a single string when present) and `context.urls` (mirror
 * list, present on `NETWORK_HTTP_ERROR` raised by `downloadFile`'s mirror-exhausted path)
 * into a deduped tuple of URL strings.
 */
const collectErrorUrls = (context: Readonly<Record<string, unknown>>): readonly string[] => {
  const urls = new Set<string>();
  if (typeof context.url === "string" && context.url.length > 0) {
    urls.add(context.url);
  }
  const listed = context.urls;
  if (Array.isArray(listed)) {
    for (const candidate of listed) {
      if (typeof candidate === "string" && candidate.length > 0) urls.add(candidate);
    }
  }
  return [...urls];
};

const findActionsByErrorUrls = (
  installPlan: InstallPlan,
  errorUrls: readonly string[],
): InstallAction[] => {
  if (errorUrls.length === 0) return [];
  const matches: InstallAction[] = [];
  for (const action of installPlan.actions) {
    if (action.kind !== InstallActionKinds.DOWNLOAD_FILE) continue;
    if (actionMatchesAnyUrl(action, errorUrls)) matches.push(action);
  }
  return matches;
};

const findActionsByErrorUrlsOrPath = (
  installPlan: InstallPlan,
  context: Readonly<Record<string, unknown>>,
): InstallAction[] => {
  const errorUrls = collectErrorUrls(context);
  const filePath = typeof context.filePath === "string" ? context.filePath : undefined;
  const matches: InstallAction[] = [];
  for (const action of installPlan.actions) {
    if (action.kind === InstallActionKinds.DOWNLOAD_FILE) {
      if (
        actionMatchesAnyUrl(action, errorUrls) ||
        (filePath !== undefined && action.target === filePath)
      ) {
        matches.push(action);
      }
      continue;
    }
    if (
      action.kind === InstallActionKinds.WRITE_VERSION_JSON ||
      action.kind === InstallActionKinds.WRITE_LOGGING_CONFIG
    ) {
      if (filePath !== undefined && action.path === filePath) {
        matches.push(action);
      }
    }
  }
  return matches;
};

const actionMatchesAnyUrl = (action: DownloadAction, errorUrls: readonly string[]): boolean => {
  if (errorUrls.length === 0) return false;
  const actionUrls = typeof action.url === "string" ? [action.url] : action.url;
  for (const candidate of actionUrls) {
    if (errorUrls.includes(candidate)) return true;
  }
  return false;
};

/**
 * Collect the entire Forge processor stage from an install plan: every forge-installer /
 * forge-library download (processors need their classpath on disk), the forge version
 * JSON write (processors regenerate it), and every `RUN_FORGE_PROCESSOR` action. We do
 * not try to pinpoint a single processor by `mainClass` — the processor chain is
 * sequential and one failure usually invalidates everything downstream.
 *
 * The vanilla-side version JSON write is intentionally excluded: vanilla writes complete
 * before any processor runs, so a processor failure cannot have invalidated them.
 */
const collectForgeProcessorStage = (installPlan: InstallPlan): InstallAction[] => {
  const forgeVersionJsonPath = resolveForgeVersionJsonPath(installPlan);
  const stage: InstallAction[] = [];
  for (const action of installPlan.actions) {
    if (action.kind === InstallActionKinds.RUN_FORGE_PROCESSOR) {
      stage.push(action);
      continue;
    }
    if (action.kind === InstallActionKinds.DOWNLOAD_FILE) {
      if (
        action.category === DownloadCategories.FORGE_LIBRARY ||
        action.category === DownloadCategories.FORGE_INSTALLER
      ) {
        stage.push(action);
      }
      continue;
    }
    if (
      action.kind === InstallActionKinds.WRITE_VERSION_JSON &&
      forgeVersionJsonPath !== undefined &&
      action.path === forgeVersionJsonPath
    ) {
      stage.push(action);
    }
  }
  return stage;
};

const resolveForgeVersionJsonPath = (installPlan: InstallPlan): string | undefined => {
  const target = installPlan.target;
  const loader = target.loader;
  if (loader === undefined || loader.type !== Loaders.FORGE) return undefined;
  return targetPaths.versionJson(target.directory, loader.fullVersion);
};
