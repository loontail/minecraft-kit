import { fileExists, fileSize, listChildDirectories, readText } from "../core/fs";
import { sha1OfFile } from "../core/hash";
import { parseJsonOrUndefined } from "../core/json";
import { targetPaths } from "../core/paths";
import { EventTypes } from "../types/events";
import type { ProgressListener } from "../types/events";
import {
  type VerificationFileResult,
  type VerificationKind,
  type VerificationResult,
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
  },
  check: (record: VerificationRecorder) => Promise<void>,
): Promise<VerificationResult> => {
  const startedAt = Date.now();
  const results: VerificationFileResult[] = [];
  const record: VerificationRecorder = (result) => {
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
 * Verify a file by existence + optional size + optional sha1.
 *
 * @internal
 */
export const verifyHashedFile = async (input: {
  readonly path: string;
  readonly expectedSha1?: string;
  readonly expectedSize?: number;
  readonly url?: string;
  readonly category: VerificationFileResult["category"];
}): Promise<VerificationFileResult> => {
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
 * Verify by existence only (no hash/size check).
 *
 * @internal
 */
export const verifyExistence = async (input: {
  readonly path: string;
  readonly category: VerificationFileResult["category"];
  readonly url?: string;
}): Promise<VerificationFileResult> => {
  if (await fileExists(input.path)) {
    return {
      path: input.path,
      category: input.category,
      status: VerifyFileStatuses.OK,
      ...(input.url !== undefined ? { url: input.url } : {}),
    };
  }
  return {
    path: input.path,
    category: input.category,
    status: VerifyFileStatuses.MISSING,
    ...(input.url !== undefined ? { url: input.url } : {}),
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
