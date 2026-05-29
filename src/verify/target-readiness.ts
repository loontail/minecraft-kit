import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import { ASPECTS, aspectsForTarget } from "../repair/aspects";
import type {
  TargetReadinessIssue,
  TargetReadinessResult,
  VerificationResult,
  VerifyAspectInput,
} from "../types/verify";

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
  input: VerifyAspectInput,
): Promise<TargetReadinessResult> => {
  const startedAt = Date.now();
  const ctx = {
    target: input.target,
    http: input.http,
    cache: input.cache,
    ...withOptionalSignal(input.signal),
    ...withOptionalOnEvent(input.onEvent),
  };

  const verifications: VerificationResult[] = [];
  for (const kind of aspectsForTarget(input.target)) {
    verifications.push(await ASPECTS[kind].verify(ctx));
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
