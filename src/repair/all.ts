import {
  type MinecraftKitError,
  type MinecraftKitErrorCode,
  MinecraftKitErrorCodes,
  isMinecraftKitError,
} from "../core/errors";
import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import type { HttpClient } from "../types/http";
import type { RepairIssueFilter, RepairReport } from "../types/repair";
import type { Spawner } from "../types/spawner";
import type { Target } from "../types/target";
import type { VerificationKind, VerificationResult } from "../types/verify";
import { ASPECTS, aspectsForTarget } from "./aspects";
import { filterRepairIssueResults } from "./helpers";
import { runRepair } from "./runner";

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
 * Why an aspect could not be repaired this run. Recorded by {@link repairAll} when planning
 * or running a repair fails with a connectivity error, so an offline "Repair" degrades to
 * "these aspects still need the network" instead of rejecting the whole operation.
 *
 * @example
 * ```ts
 * const report = await kit.repair.all(target);
 * for (const [aspect, blocker] of report.blockedAspects) {
 *   console.warn(`${aspect} could not be repaired offline: ${blocker.message}`);
 * }
 * ```
 */
export type RepairBlockedAspect = {
  readonly code: MinecraftKitErrorCode;
  readonly message: string;
};

/**
 * Result of {@link repairAll}: every verification it ran, every repair it performed, every
 * aspect a connectivity failure blocked, and the aggregate cost.
 *
 * @example
 * ```ts
 * import type { RepairAllReport } from "@loontail/minecraft-kit";
 *
 * const report: RepairAllReport = await kit.repair.all(target);
 * console.log(`verified ${report.verifications.length} aspects`);
 * console.log(`repaired ${report.repairs.size}, blocked ${report.blockedAspects.size}`);
 * ```
 */
export type RepairAllReport = {
  readonly verifications: readonly VerificationResult[];
  /** Present only for aspects that actually needed work. */
  readonly repairs: ReadonlyMap<VerificationKind, RepairReport>;
  /** Aspects skipped because their repair needs the network and it was unreachable. */
  readonly blockedAspects: ReadonlyMap<VerificationKind, RepairBlockedAspect>;
  readonly bytesDownloaded: number;
  readonly durationMs: number;
};

/**
 * Connectivity error codes that mark an aspect as blocked rather than failing the whole run.
 * A bad-shape (`MANIFEST_INVALID`) or aborted (`NETWORK_ABORTED`) error is not "offline" and
 * is allowed to propagate.
 */
const NETWORK_BLOCKING_CODES: ReadonlySet<MinecraftKitErrorCode> = new Set([
  MinecraftKitErrorCodes.NETWORK_TIMEOUT,
  MinecraftKitErrorCodes.NETWORK_HTTP_ERROR,
]);

const isNetworkBlocked = (error: unknown): error is MinecraftKitError =>
  isMinecraftKitError(error) && NETWORK_BLOCKING_CODES.has(error.code);

/**
 * Verify every applicable aspect and repair each broken one. Aspects whose repair cannot
 * reach the network are reported in `blockedAspects` instead of rejecting the operation, so
 * an offline "Repair" still fixes everything that is locally fixable.
 *
 * Prefer `kit.repair.all(target)` over importing this directly.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const report = await kit.repair.all(target, { onEvent: (e) => console.log(e.type) });
 * if (report.repairs.size === 0 && report.blockedAspects.size === 0) {
 *   console.log("everything was already valid");
 * }
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
  for (const kind of aspectsForTarget(input.target)) {
    rawVerifications.push(await ASPECTS[kind].verify(verificationCtx));
  }
  const verifications = filterRepairIssueResults({
    target: input.target,
    from: rawVerifications,
    ...(input.shouldRepairIssue === undefined
      ? {}
      : { shouldRepairIssue: input.shouldRepairIssue }),
  });

  const repairs = new Map<VerificationKind, RepairReport>();
  const blockedAspects = new Map<VerificationKind, RepairBlockedAspect>();
  let bytesDownloaded = 0;

  for (const verification of verifications) {
    if (verification.isValid) continue;
    try {
      const plan = await ASPECTS[verification.kind].plan({ ...ctx, from: verification });
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
    } catch (error) {
      if (input.signal?.aborted !== true && isNetworkBlocked(error)) {
        blockedAspects.set(verification.kind, { code: error.code, message: error.message });
        continue;
      }
      throw error;
    }
  }

  return {
    verifications,
    repairs,
    blockedAspects,
    bytesDownloaded,
    durationMs: Date.now() - startedAt,
  };
};

const withAspectOnEvent = (
  onEvent: ProgressListener | undefined,
  aspect: VerificationKind,
): { onEvent?: ProgressListener } => {
  if (onEvent === undefined) return {};
  const listener: ProgressListener = (event) => onEvent({ ...event, aspect });
  return { onEvent: listener };
};
