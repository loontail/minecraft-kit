import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import type { HttpClient } from "../types/http";
import { Loaders } from "../types/loader";
import type { RepairReport } from "../types/repair";
import type { Spawner } from "../types/spawner";
import type { Target } from "../types/target";
import type { VerificationKind, VerificationResult } from "../types/verify";
import { verifyFabric } from "../verify/fabric";
import { verifyForge } from "../verify/forge";
import { verifyMinecraft } from "../verify/minecraft";
import { verifyRuntime } from "../verify/runtime";
import { planFabricRepair } from "./fabric";
import { planForgeRepair } from "./forge";
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
};

export type RepairAllReport = {
  readonly verifications: readonly VerificationResult[];
  /** Present only for aspects that actually needed work. */
  readonly repairs: ReadonlyMap<VerificationKind, RepairReport>;
  readonly bytesDownloaded: number;
  readonly durationMs: number;
};

/** Verify every applicable aspect and repair each broken one. */
export const repairAll = async (input: RepairAllInput): Promise<RepairAllReport> => {
  const startedAt = Date.now();
  const ctx = {
    target: input.target,
    http: input.http,
    cache: input.cache,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  };

  const verifications: VerificationResult[] = [];
  const mc = await verifyMinecraft(ctx);
  verifications.push(mc);
  const rt = await verifyRuntime(ctx);
  verifications.push(rt);
  if (input.target.loader.type === Loaders.FABRIC) {
    verifications.push(await verifyFabric(ctx));
  } else if (input.target.loader.type === Loaders.FORGE) {
    verifications.push(await verifyForge(ctx));
  }

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
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
      ...(input.onEvent !== undefined ? { onEvent: input.onEvent } : {}),
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
