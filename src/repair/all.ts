import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import type { HttpClient } from "../types/http";
import { Loaders } from "../types/loader";
import type { RepairIssueFilter, RepairReport } from "../types/repair";
import type { Spawner } from "../types/spawner";
import type { Target } from "../types/target";
import type { VerificationKind, VerificationResult } from "../types/verify";
import { verifyFabric } from "../verify/fabric";
import { verifyForge } from "../verify/forge";
import { verifyMinecraft } from "../verify/minecraft";
import { verifyRuntime } from "../verify/runtime";
import { planFabricRepair } from "./fabric";
import { planForgeRepair } from "./forge";
import { filterRepairIssueResults } from "./helpers";
import { planMinecraftRepair } from "./minecraft";
import { runRepair } from "./runner";
import { planRuntimeRepair } from "./runtime";

/** @internal */
export type RepairAllInput = {
  readonly target: Target;
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly spawner: Spawner;
  readonly signal?: AbortSignal;
  readonly onEvent?: ProgressListener;
  readonly shouldRepairIssue?: RepairIssueFilter;
  /** Host allow-list forwarded to the repair runner's downloads. */
  readonly hostAllowList?: readonly string[];
};

/**
 * Result of {@link repairAll}: every verification it ran, every repair it performed, and the
 * aggregate cost.
 *
 * @example
 * ```ts
 * import type { RepairAllReport } from "@loontail/minecraft-kit";
 *
 * const report: RepairAllReport = await kit.repair.all(target);
 * console.log(`verified ${report.verifications.length} aspects`);
 * console.log(`repaired ${report.repairs.size}, downloaded ${report.bytesDownloaded} bytes`);
 * ```
 */
export type RepairAllReport = {
  readonly verifications: readonly VerificationResult[];
  /** Present only for aspects that actually needed work. */
  readonly repairs: ReadonlyMap<VerificationKind, RepairReport>;
  readonly bytesDownloaded: number;
  readonly durationMs: number;
};

/**
 * Verify every applicable aspect and repair each broken one.
 *
 * Prefer `kit.repair.all(target)` over importing this directly.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const report = await kit.repair.all(target, { onEvent: (e) => console.log(e.type) });
 * if (report.repairs.size === 0) console.log("everything was already valid");
 * ```
 */
export const repairAll = async (input: RepairAllInput): Promise<RepairAllReport> => {
  const startedAt = Date.now();
  const ctx = {
    target: input.target,
    http: input.http,
    cache: input.cache,
    ...withOptionalSignal(input.signal),
  };
  const verificationCtx = {
    ...ctx,
    ...withOptionalOnEvent(input.onEvent),
  };

  const rawVerifications: VerificationResult[] = [];
  const mc = await verifyMinecraft(verificationCtx);
  rawVerifications.push(mc);
  const rt = await verifyRuntime(verificationCtx);
  rawVerifications.push(rt);
  if (input.target.loader.type === Loaders.FABRIC) {
    rawVerifications.push(await verifyFabric(verificationCtx));
  } else if (input.target.loader.type === Loaders.FORGE) {
    rawVerifications.push(await verifyForge(verificationCtx));
  }
  const verifications = filterRepairIssueResults({
    target: input.target,
    from: rawVerifications,
    ...(input.shouldRepairIssue === undefined
      ? {}
      : { shouldRepairIssue: input.shouldRepairIssue }),
  });

  const repairs = new Map<VerificationKind, RepairReport>();
  let bytesDownloaded = 0;

  for (const verification of verifications) {
    if (verification.isValid) continue;
    const planner = PLANNERS[verification.kind];
    if (!planner) continue;
    const plan = await planner({ ...ctx, from: verification });
    if (plan.totalActions === 0) continue;
    const report = await runRepair({
      plan,
      http: input.http,
      cache: input.cache,
      spawner: input.spawner,
      ...(input.hostAllowList !== undefined ? { hostAllowList: input.hostAllowList } : {}),
      ...withOptionalSignal(input.signal),
      ...withAspectOnEvent(input.onEvent, verification.kind),
    });
    repairs.set(verification.kind, report);
    bytesDownloaded += report.bytesDownloaded;
  }

  return {
    verifications,
    repairs,
    bytesDownloaded,
    durationMs: Date.now() - startedAt,
  };
};

const PLANNERS = {
  minecraft: planMinecraftRepair,
  runtime: planRuntimeRepair,
  fabric: planFabricRepair,
  forge: planForgeRepair,
} as const;

const withAspectOnEvent = (
  onEvent: ProgressListener | undefined,
  aspect: VerificationKind,
): { onEvent?: ProgressListener } => {
  if (onEvent === undefined) return {};
  const listener: ProgressListener = (event) => onEvent({ ...event, aspect });
  return { onEvent: listener };
};
