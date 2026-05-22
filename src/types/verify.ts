/**
 * Aspect of an installation a verification result describes.
 *
 * @example
 * ```ts
 * import { VerificationKinds } from "@loontail/minecraft-kit";
 *
 * const report = await kit.repair.all(target);
 * const fixedAspects = [...report.repairs.keys()];
 * if (fixedAspects.includes(VerificationKinds.FORGE)) console.log("forge was repaired");
 * ```
 */
export const VerificationKinds = {
  MINECRAFT: "minecraft",
  FABRIC: "fabric",
  FORGE: "forge",
  RUNTIME: "runtime",
} as const;

/**
 * Verification kind literal.
 *
 * @example
 * ```ts
 * import { VerificationKinds, type VerificationKind } from "@loontail/minecraft-kit";
 *
 * const isLoader = (k: VerificationKind) =>
 *   k === VerificationKinds.FABRIC || k === VerificationKinds.FORGE;
 * ```
 */
export type VerificationKind = (typeof VerificationKinds)[keyof typeof VerificationKinds];

/**
 * Status of an individual file checked during verification.
 *
 * @example
 * ```ts
 * import { VerifyFileStatuses } from "@loontail/minecraft-kit";
 *
 * const result = await kit.verify.minecraft.run(target);
 * const missing = result.issues.filter((i) => i.status === VerifyFileStatuses.MISSING);
 * ```
 */
export const VerifyFileStatuses = {
  OK: "ok",
  MISSING: "missing",
  CORRUPT: "corrupt",
  WRONG_SIZE: "wrong-size",
} as const;

/**
 * File status literal.
 *
 * @example
 * ```ts
 * import { VerifyFileStatuses, type VerifyFileStatus } from "@loontail/minecraft-kit";
 *
 * const isBroken = (status: VerifyFileStatus) => status !== VerifyFileStatuses.OK;
 * ```
 */
export type VerifyFileStatus = (typeof VerifyFileStatuses)[keyof typeof VerifyFileStatuses];

/**
 * Categories assigned to each verified file for easier filtering.
 *
 * @example
 * ```ts
 * import { VerifyFileCategories } from "@loontail/minecraft-kit";
 *
 * const result = await kit.verify.minecraft.run(target);
 * const brokenAssets = result.issues.filter((i) => i.category === VerifyFileCategories.ASSET);
 * ```
 */
export const VerifyFileCategories = {
  CLIENT_JAR: "client-jar",
  LIBRARY: "library",
  ASSET: "asset",
  ASSET_INDEX: "asset-index",
  NATIVE: "native",
  LOADER_LIBRARY: "loader-library",
  RUNTIME_FILE: "runtime-file",
  LOGGING_CONFIG: "logging-config",
} as const;

/**
 * Verification file category literal.
 *
 * @example
 * ```ts
 * import { VerifyFileCategories, type VerifyFileCategory } from "@loontail/minecraft-kit";
 *
 * const isRuntime = (c: VerifyFileCategory) => c === VerifyFileCategories.RUNTIME_FILE;
 * ```
 */
export type VerifyFileCategory = (typeof VerifyFileCategories)[keyof typeof VerifyFileCategories];

/**
 * A single verified file.
 *
 * @example
 * ```ts
 * import { VerifyFileStatuses, type VerificationFileResult } from "@loontail/minecraft-kit";
 *
 * const issues: readonly VerificationFileResult[] = result.issues;
 * for (const i of issues) {
 *   if (i.status === VerifyFileStatuses.CORRUPT) console.warn(`corrupt: ${i.path}`);
 * }
 * ```
 */
export type VerificationFileResult = {
  readonly path: string;
  readonly category: VerifyFileCategory;
  readonly status: VerifyFileStatus;
  readonly expectedSha1?: string;
  readonly actualSha1?: string;
  readonly expectedSize?: number;
  readonly actualSize?: number;
  /** Optional URL where the file can be re-downloaded if it's broken. */
  readonly url?: string;
};

/**
 * Aggregate verification result returned by each `verify.<kind>.run` API.
 *
 * @example
 * ```ts
 * import type { VerificationResult } from "@loontail/minecraft-kit";
 *
 * const result: VerificationResult = await kit.verify.minecraft.run(target);
 * console.log(`${result.kind}: ${result.isValid ? "ok" : `${result.issues.length} issues`}`);
 * ```
 */
export type VerificationResult = {
  readonly targetId: string;
  readonly kind: VerificationKind;
  readonly isValid: boolean;
  readonly issues: readonly VerificationFileResult[];
  readonly checkedFiles: number;
  readonly durationMs: number;
};
