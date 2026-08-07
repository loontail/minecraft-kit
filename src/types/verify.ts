import type { MetadataCache } from "./cache";
import type { OperationOptions } from "./events";
import type { HttpClient } from "./http";
import type { Target } from "./target";

/**
 * Aspect of an installation a verification result describes.
 */
export const VerificationKinds = {
  MINECRAFT: "minecraft",
  FABRIC: "fabric",
  FORGE: "forge",
  RUNTIME: "runtime",
} as const;

/**
 * Verification kind literal.
 */
export type VerificationKind = (typeof VerificationKinds)[keyof typeof VerificationKinds];

/**
 * Status of an individual file checked during verification.
 */
export const VerifyFileStatuses = {
  OK: "ok",
  MISSING: "missing",
  CORRUPT: "corrupt",
  WRONG_SIZE: "wrong-size",
} as const;

/**
 * File status literal.
 */
export type VerifyFileStatus = (typeof VerifyFileStatuses)[keyof typeof VerifyFileStatuses];

/**
 * Categories assigned to each verified file for easier filtering.
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
  /**
   * A file a Forge processor generates locally (srg/slim/extra/patched client JARs). Nothing
   * downloads these, so a repair has to re-run the processor that produces them rather than
   * fetch a URL.
   */
  FORGE_PROCESSOR_OUTPUT: "forge-processor-output",
} as const;

/**
 * Verification file category literal.
 */
export type VerifyFileCategory = (typeof VerifyFileCategories)[keyof typeof VerifyFileCategories];

/**
 * A single verified file.
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
 */
export type VerificationResult = {
  readonly targetId: string;
  readonly kind: VerificationKind;
  readonly isValid: boolean;
  readonly issues: readonly VerificationFileResult[];
  readonly checkedFiles: number;
  readonly durationMs: number;
};

/**
 * A verification issue annotated with the aspect that produced it.
 */
export type TargetReadinessIssue = VerificationFileResult & {
  readonly kind: VerificationKind;
};

/**
 * Aggregate launch-readiness report for every aspect that applies to a target.
 */
export type TargetReadinessResult = {
  readonly targetId: string;
  readonly isReady: boolean;
  readonly verifications: readonly VerificationResult[];
  readonly issues: readonly TargetReadinessIssue[];
  readonly durationMs: number;
};

/**
 * Options accepted by every `verify.<kind>.run`.
 */
export type VerifyOperationOptions = OperationOptions;

/**
 * Inputs shared by every per-aspect verifier (`verifyMinecraft`, `verifyRuntime`,
 * `verifyFabric`, `verifyForge`) and the readiness aggregator (`verifyTargetReadiness`).
 * One shape so the verifiers and the dispatch sites that call them cannot drift.
 *
 * @internal
 */
export type VerifyAspectInput = {
  readonly target: Target;
  readonly http: HttpClient;
  readonly cache: MetadataCache;
} & VerifyOperationOptions;
