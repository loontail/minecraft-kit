import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import type { HttpClient } from "../types/http";
import { Loaders } from "../types/loader";
import type { Target } from "../types/target";
import type {
  TargetReadinessIssue,
  TargetReadinessResult,
  VerificationResult,
} from "../types/verify";
import { verifyFabric } from "./fabric";
import { verifyForge } from "./forge";
import { verifyMinecraft } from "./minecraft";
import { verifyRuntime } from "./runtime";

/**
 * Inputs to {@link verifyTargetReadiness}.
 *
 * @internal
 */
export type VerifyTargetReadinessInput = {
  readonly target: Target;
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly signal?: AbortSignal;
  readonly onEvent?: ProgressListener;
};

/**
 * Verify every launch-critical aspect that applies to the target.
 *
 * Prefer `kit.verify.targetReady.run(target)` over importing this directly.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const readiness = await kit.verify.targetReady.run(target);
 * if (!readiness.isReady) console.warn(`${readiness.issues.length} launch blockers`);
 * ```
 */
export const verifyTargetReadiness = async (
  input: VerifyTargetReadinessInput,
): Promise<TargetReadinessResult> => {
  const startedAt = Date.now();
  const ctx = {
    target: input.target,
    http: input.http,
    cache: input.cache,
    ...withOptionalSignal(input.signal),
    ...withOptionalOnEvent(input.onEvent),
  };

  const verifications: VerificationResult[] = [
    await verifyMinecraft(ctx),
    await verifyRuntime(ctx),
  ];

  if (input.target.loader.type === Loaders.FABRIC) {
    verifications.push(await verifyFabric(ctx));
  } else if (input.target.loader.type === Loaders.FORGE) {
    verifications.push(await verifyForge(ctx));
  }

  const issues: TargetReadinessIssue[] = verifications.flatMap((verification) =>
    verification.issues.map((issue) => ({ ...issue, kind: verification.kind })),
  );

  return {
    targetId: input.target.id,
    isReady: verifications.every((verification) => verification.isValid),
    verifications,
    issues,
    durationMs: Date.now() - startedAt,
  };
};
