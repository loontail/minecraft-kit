import pLimit from "p-limit";
import { VERIFY_CONCURRENCY } from "../constants/defaults";
import { assertNotAborted } from "../core/abort";
import { fileExists, fileSize, listChildDirectories, readText } from "../core/fs";
import { sha1OfFile } from "../core/hash";
import { parseJsonOrUndefined } from "../core/json";
import { targetPaths } from "../core/paths";
import { pickPrimaryDownloadUrl } from "../http/download";
import type { LibraryPlan } from "../install/libraries";
import type { ProgressListener } from "../types/events";
import { EventTypes } from "../types/events";
import {
  type VerificationFileResult,
  type VerificationKind,
  type VerificationResult,
  type VerifyFileCategory,
  VerifyFileStatuses,
} from "../types/verify";

/**
 * Records a single file-check result and emits the corresponding event.
 *
 * @internal
 */
export type VerificationRecorder = (result: VerificationFileResult) => void;

/**
 * Run the boilerplate shared by every aspect verifier: tracks the per-file results emitted
 * via the recorder, fires `verify:file-checked` events, and assembles the {@link VerificationResult}.
 *
 * @internal
 */
export const runVerification = async (
  input: {
    readonly targetId: string;
    readonly kind: VerificationKind;
    readonly onEvent?: ProgressListener;
    readonly signal?: AbortSignal;
  },
  check: (record: VerificationRecorder) => Promise<void>,
): Promise<VerificationResult> => {
  const startedAt = Date.now();
  const results: VerificationFileResult[] = [];
  const record: VerificationRecorder = (result) => {
    assertNotAborted(input.signal, "Verification aborted by signal");
    results.push(result);
    input.onEvent?.({ type: EventTypes.VERIFY_FILE_CHECKED, file: result, aspect: input.kind });
  };
  await check(record);
  return {
    targetId: input.targetId,
    kind: input.kind,
    isValid: results.every((r) => r.status === VerifyFileStatuses.OK),
    issues: results.filter((r) => r.status !== VerifyFileStatuses.OK),
    checkedFiles: results.length,
    durationMs: Date.now() - startedAt,
  };
};

/**
 * Inputs accepted by {@link verifyHashedFile} / {@link verifyHashedFiles}.
 *
 * @internal
 */
export type VerifyHashedFileInput = {
  readonly path: string;
  readonly expectedSha1?: string;
  readonly expectedSize?: number;
  readonly url?: string;
  readonly category: VerificationFileResult["category"];
};

/**
 * Verify a file by existence + optional size + optional sha1.
 *
 * @internal
 */
export const verifyHashedFile = async (
  input: VerifyHashedFileInput,
): Promise<VerificationFileResult> => {
  if (!(await fileExists(input.path))) {
    return {
      path: input.path,
      category: input.category,
      status: VerifyFileStatuses.MISSING,
      ...(input.expectedSha1 !== undefined ? { expectedSha1: input.expectedSha1 } : {}),
      ...(input.expectedSize !== undefined ? { expectedSize: input.expectedSize } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
    };
  }
  if (input.expectedSize !== undefined) {
    const size = await fileSize(input.path);
    if (size !== input.expectedSize) {
      return {
        path: input.path,
        category: input.category,
        status: VerifyFileStatuses.WRONG_SIZE,
        expectedSize: input.expectedSize,
        actualSize: size,
        ...(input.expectedSha1 !== undefined ? { expectedSha1: input.expectedSha1 } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
      };
    }
  }
  if (input.expectedSha1 !== undefined) {
    const actualSha1 = await sha1OfFile(input.path);
    if (actualSha1 !== input.expectedSha1) {
      return {
        path: input.path,
        category: input.category,
        status: VerifyFileStatuses.CORRUPT,
        expectedSha1: input.expectedSha1,
        actualSha1,
        ...(input.expectedSize !== undefined ? { expectedSize: input.expectedSize } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
      };
    }
  }
  return {
    path: input.path,
    category: input.category,
    status: VerifyFileStatuses.OK,
    ...(input.expectedSha1 !== undefined ? { expectedSha1: input.expectedSha1 } : {}),
    ...(input.expectedSize !== undefined ? { expectedSize: input.expectedSize } : {}),
    ...(input.url !== undefined ? { url: input.url } : {}),
  };
};

/**
 * Hash-verify many files through a {@link VERIFY_CONCURRENCY}-wide pool, recording results in
 * input order as the pool lands them.
 *
 * Order is what consumers (the tests here, and the launcher's progress adapter) key off, so each
 * completed task only flushes the prefix of results that is already complete: a file waits for the
 * files before it, never for the whole pool. Waiting for the pool to drain would be simpler but
 * turns the largest bucket in the kit (~4,000 asset objects) into multi-second silence followed by
 * one burst of 4,000 `verify:file-checked` events on a single tick.
 *
 * The signal is re-checked inside each pooled task so an abort stops the queue from draining
 * instead of only being noticed at the next `record()`.
 *
 * @internal
 */
export const verifyHashedFiles = async (
  record: VerificationRecorder,
  inputs: readonly VerifyHashedFileInput[],
  signal?: AbortSignal,
): Promise<void> => {
  if (inputs.length === 0) return;
  const limit = pLimit(VERIFY_CONCURRENCY);
  const slots: (VerificationFileResult | undefined)[] = Array.from({ length: inputs.length });
  let flushed = 0;
  const flushCompletedPrefix = (): void => {
    for (;;) {
      const result = slots[flushed];
      if (result === undefined) return;
      flushed++;
      record(result);
    }
  };
  await Promise.all(
    inputs.map((input, index) =>
      limit(async () => {
        assertNotAborted(signal, "Verification aborted by signal");
        slots[index] = await verifyHashedFile(input);
        flushCompletedPrefix();
      }),
    ),
  );
};

/**
 * Record a {@link verifyHashedFile} result for every library download in a plan under the
 * given category. Shared by the Minecraft, Fabric, and Forge verifiers — the loop body and
 * the `pickPrimaryDownloadUrl` mirror-selection are identical across all three.
 *
 * @internal
 */
export const recordLibraryDownloads = async (
  record: VerificationRecorder,
  plan: LibraryPlan,
  category: VerifyFileCategory,
  signal?: AbortSignal,
): Promise<void> => {
  await verifyHashedFiles(
    record,
    plan.downloads.map((action) => ({
      path: action.target,
      ...(action.expectedSha1 !== undefined ? { expectedSha1: action.expectedSha1 } : {}),
      ...(action.expectedSize !== undefined ? { expectedSize: action.expectedSize } : {}),
      url: pickPrimaryDownloadUrl(action.url),
      category,
    })),
    signal,
  );
};

/**
 * Verify by existence only (no hash/size check).
 *
 * @internal
 */
export const verifyExistence = async (input: {
  readonly path: string;
  readonly category: VerificationFileResult["category"];
}): Promise<VerificationFileResult> => {
  if (await fileExists(input.path)) {
    return {
      path: input.path,
      category: input.category,
      status: VerifyFileStatuses.OK,
    };
  }
  return {
    path: input.path,
    category: input.category,
    status: VerifyFileStatuses.MISSING,
  };
};

/**
 * Locate a Forge version JSON on disk for the given Minecraft version. Returns the
 * discovered path even if the JSON file itself is missing — callers use the path to record
 * a MISSING issue and trigger a write/repair downstream. Returns null when the versions
 * directory has no Forge folder for this Minecraft version.
 *
 * @internal
 */
export const findForgeVersionJsonPath = async (
  directory: string,
  minecraftVersion: string,
): Promise<string | null> => {
  const versionsDir = targetPaths.versionsDir(directory);
  const dirs = await listChildDirectories(versionsDir);
  for (const id of dirs) {
    if (!id.startsWith(`${minecraftVersion}-forge-`)) continue;
    const jsonPath = targetPaths.versionJson(directory, id);
    if (!(await fileExists(jsonPath))) {
      return jsonPath;
    }
    const parsed = await tryParseInheritsFrom(jsonPath);
    if (parsed === minecraftVersion) return jsonPath;
  }
  return null;
};

/**
 * Read `inheritsFrom` from a Forge version JSON file. Returns `undefined` when the file is
 * malformed; callers treat that as a non-match — the next verify pass will surface the file
 * through the regular file-check path.
 */
const tryParseInheritsFrom = async (jsonPath: string): Promise<string | undefined> => {
  const parsed = parseJsonOrUndefined<{ inheritsFrom?: string }>(await readText(jsonPath));
  return parsed?.inheritsFrom;
};
