import { MojangAuthApi } from "./auth/index";
import { silentLogger } from "./core/logger";
import type { PauseController } from "./core/pause-controller";
import { detectSystem } from "./core/system";
import { createMemoryCache } from "./http/cache";
import { FetchHttpClient } from "./http/client";
import { planInstall } from "./install/planner";
import { runInstall } from "./install/runner";
import {
  type PlanStandaloneRuntimeInstallInput,
  planRuntimeInstall,
  planStandaloneRuntimeInstall,
} from "./install/runtime-install";
import { composeLaunch } from "./launch/compose";
import { runLaunch } from "./launch/runner";
import { ChildProcessSpawner } from "./launch/spawner";
import { type RepairAllReport, repairAll } from "./repair/all";
import { planFabricRepair } from "./repair/fabric";
import { planForgeRepair } from "./repair/forge";
import { planMinecraftRepair } from "./repair/minecraft";
import { runRepair } from "./repair/runner";
import { planRuntimeRepair } from "./repair/runtime";
import { TargetsApi } from "./targets/index";
import type { MetadataCache } from "./types/cache";
import type { OperationOptions, ProgressListener } from "./types/events";
import type { HttpClient } from "./types/http";
import type { DownloadAction, InstallPlan, InstallReport } from "./types/install";
import type {
  LaunchComposition,
  LaunchOptions,
  LaunchRunOptions,
  LaunchSession,
} from "./types/launch";
import type { Logger } from "./types/logger";
import type { RepairPlan, RepairReport } from "./types/repair";
import type { Spawner } from "./types/spawner";
import type { RuntimeSystem } from "./types/system";
import type { Target } from "./types/target";
import type { VerificationResult } from "./types/verify";
import { verifyFabric } from "./verify/fabric";
import { verifyForge } from "./verify/forge";
import { verifyMinecraft } from "./verify/minecraft";
import { verifyRuntime } from "./verify/runtime";
import { FabricVersionsApi } from "./versions/fabric";
import { ForgeVersionsApi } from "./versions/forge";
import { MinecraftVersionsApi } from "./versions/minecraft";
import { RuntimeVersionsApi } from "./versions/runtime";

/** Constructor options for {@link MinecraftKit}. */
export type MinecraftKitOptions = {
  readonly httpClient?: HttpClient;
  readonly cache?: MetadataCache;
  readonly logger?: Logger;
  readonly system?: RuntimeSystem;
  readonly spawner?: Spawner;
};

/**
 * Single facade for the entire library.
 *
 * @example
 * ```ts
 * const kit = new MinecraftKit();
 * const target = await kit.targets.resolve({ id, directory, minecraft: { version: '1.20.1' }, loader: { type: Loaders.VANILLA } });
 * const plan = await kit.install.plan(target);
 * await kit.install.run(plan, { onEvent: console.log });
 * ```
 */
export class MinecraftKit {
  readonly versions: {
    readonly minecraft: MinecraftVersionsApi;
    readonly fabric: FabricVersionsApi;
    readonly forge: ForgeVersionsApi;
    readonly runtime: RuntimeVersionsApi;
  };
  readonly targets: TargetsApi;
  readonly install: {
    plan(target: Target, options?: OperationOptions): Promise<InstallPlan>;
    run(plan: InstallPlan, options?: InstallRunOptions): Promise<InstallReport>;
    /** Install only the Java runtime declared by `target.runtime` (honours `installRoot`). */
    readonly runtime: {
      plan(target: Target, options?: OperationOptions): Promise<InstallPlan>;
      run(plan: InstallPlan, options?: InstallRunOptions): Promise<InstallReport>;
      /**
       * Plan a runtime-only install without an existing Minecraft Target. The caller
       * supplies a {@link ResolvedRuntime} (typically from `kit.versions.runtime.resolve`)
       * plus a directory and stable id.
       */
      standalonePlan(
        input: Omit<PlanStandaloneRuntimeInstallInput, "http" | "cache">,
      ): Promise<InstallPlan>;
    };
  };
  readonly verify: {
    /** Verify the vanilla Minecraft slice (client jar, libraries, assets, natives, log config). */
    readonly minecraft: {
      run(target: Target, options?: VerifyOperationOptions): Promise<VerificationResult>;
    };
    /** Verify the Fabric loader slice (profile JSON + libraries). Throws on non-Fabric targets. */
    readonly fabric: {
      run(target: Target, options?: VerifyOperationOptions): Promise<VerificationResult>;
    };
    /** Verify the Forge loader slice (version JSON + libraries). Throws on non-Forge targets. */
    readonly forge: {
      run(target: Target, options?: VerifyOperationOptions): Promise<VerificationResult>;
    };
    /** Verify the Java runtime files. Honours `target.runtime.installRoot` for shared installs. */
    readonly runtime: {
      run(target: Target, options?: VerifyOperationOptions): Promise<VerificationResult>;
    };
  };
  readonly repair: {
    /** Repair the vanilla Minecraft slice (client jar, libraries, assets, natives, log config). */
    readonly minecraft: RepairAspect;
    /** Repair the Fabric loader slice (profile JSON + libraries). Throws on non-Fabric targets. */
    readonly fabric: RepairAspect;
    /** Repair the Forge loader slice (version JSON + libraries + processors). Throws on non-Forge. */
    readonly forge: RepairAspect;
    /** Repair the Java runtime files. Honours `target.runtime.installRoot`. */
    readonly runtime: RepairAspect;
    /** Verify every applicable aspect (Minecraft + Runtime + active loader) and repair each broken one. */
    all(target: Target, options?: OperationOptions): Promise<RepairAllReport>;
  };
  readonly launch: {
    compose(target: Target, options: LaunchOptions): Promise<LaunchComposition>;
    run(composition: LaunchComposition, options?: LaunchRunOptions): LaunchSession;
  };
  /**
   * Microsoft / Mojang authentication. Runs the OAuth 2.0 Authorization-Code + PKCE flow
   * over a loopback redirect to mint an Xbox + Minecraft session for `launch.compose`.
   */
  readonly auth: MojangAuthApi;

  /** Cache surface useful for advanced consumers (e.g. clearing between operations). */
  readonly cache: MetadataCache;

  constructor(options: MinecraftKitOptions = {}) {
    const http = options.httpClient ?? new FetchHttpClient();
    const cache = options.cache ?? createMemoryCache();
    const logger = options.logger ?? silentLogger;
    const system = options.system ?? detectSystem();
    const spawner = options.spawner ?? new ChildProcessSpawner();
    const ctx = { http, cache, logger };

    const minecraft = new MinecraftVersionsApi(ctx);
    const fabric = new FabricVersionsApi(ctx);
    const forge = new ForgeVersionsApi(ctx);
    const runtime = new RuntimeVersionsApi(ctx);
    this.versions = { minecraft, fabric, forge, runtime };
    this.targets = new TargetsApi({ minecraft, fabric, forge, runtime, system });
    this.auth = new MojangAuthApi(http);
    this.cache = cache;

    // Carry signal/onEvent from operation-level options through to internal call sites.
    // Centralising this avoids the same conditional spread appearing in every method below.
    const carry = (opts: { signal?: AbortSignal; onEvent?: ProgressListener } | undefined) => ({
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.onEvent !== undefined ? { onEvent: opts.onEvent } : {}),
    });

    const carryInstall = (opts: InstallRunOptions | undefined) => ({
      ...carry(opts),
      ...(opts?.pauseController !== undefined ? { pauseController: opts.pauseController } : {}),
      ...(opts?.actionCategories !== undefined ? { actionCategories: opts.actionCategories } : {}),
    });

    const runInstallPlan = (plan: InstallPlan, opts?: InstallRunOptions) =>
      runInstall({ plan, http, cache, spawner, ...carryInstall(opts) });

    this.install = {
      plan: (target, opts) => planInstall({ target, http, cache, ...carry(opts) }),
      run: runInstallPlan,
      runtime: {
        plan: (target, opts) => planRuntimeInstall({ target, http, cache, ...carry(opts) }),
        run: runInstallPlan,
        standalonePlan: (input) => planStandaloneRuntimeInstall({ ...input, http, cache }),
      },
    };

    const verifyArgs = (target: Target, opts?: VerifyOperationOptions) => ({
      target,
      http,
      cache,
      ...carry(opts),
    });
    this.verify = {
      minecraft: { run: (target, opts) => verifyMinecraft(verifyArgs(target, opts)) },
      fabric: { run: (target, opts) => verifyFabric(verifyArgs(target, opts)) },
      forge: { run: (target, opts) => verifyForge(verifyArgs(target, opts)) },
      runtime: { run: (target, opts) => verifyRuntime(verifyArgs(target, opts)) },
    };

    const repairArgs = (target: Target, opts: RepairPlanOptions) => ({
      target,
      from: opts.from,
      http,
      cache,
      ...carry({ ...(opts.signal !== undefined ? { signal: opts.signal } : {}) }),
    });
    const runRepairPlan: RepairAspect["run"] = (plan, opts) =>
      runRepair({ plan, http, cache, spawner, ...carry(opts) });
    this.repair = {
      minecraft: {
        plan: (target, opts) => planMinecraftRepair(repairArgs(target, opts)),
        run: runRepairPlan,
      },
      fabric: {
        plan: (target, opts) => planFabricRepair(repairArgs(target, opts)),
        run: runRepairPlan,
      },
      forge: {
        plan: (target, opts) => planForgeRepair(repairArgs(target, opts)),
        run: runRepairPlan,
      },
      runtime: {
        plan: (target, opts) => planRuntimeRepair(repairArgs(target, opts)),
        run: runRepairPlan,
      },
      all: (target, opts) =>
        repairAll({
          target,
          http,
          cache,
          spawner,
          ...carry(opts),
        }),
    };

    this.launch = {
      compose: (target, opts) => composeLaunch({ target, options: opts, logger }),
      run: (composition, opts) =>
        runLaunch({
          composition,
          ...(opts !== undefined ? { options: opts } : {}),
          spawner,
        }),
    };
  }
}

/** Options accepted by `install.run` (and `install.runtime.run`). */
export interface InstallRunOptions extends OperationOptions {
  /**
   * Cooperative pause/resume primitive — see {@link PauseController}. The runner checks the
   * pause state at every stage boundary and between download chunks.
   */
  readonly pauseController?: PauseController;
  /**
   * Filter the run to a subset of action categories. Useful for partial reinstalls
   * (e.g. assets-only). When omitted, every action in the plan runs.
   *
   * @example
   * ```ts
   * import { DownloadCategories } from "@loontail/minecraft-kit";
   *
   * await kit.install.run(plan, {
   *   actionCategories: new Set([
   *     DownloadCategories.CLIENT_JAR,
   *     DownloadCategories.LIBRARY,
   *     DownloadCategories.ASSET_INDEX,
   *     DownloadCategories.ASSET,
   *   ]),
   * });
   * ```
   */
  readonly actionCategories?: ReadonlySet<DownloadAction["category"]>;
}

/** Options accepted by every `verify.<kind>.run`. */
export type VerifyOperationOptions = {
  readonly signal?: AbortSignal;
  readonly onEvent?: ProgressListener;
};

/** Options for any `repair.<aspect>.plan` call. Accepts one or many verification results. */
export type RepairPlanOptions = {
  readonly from: VerificationResult | readonly VerificationResult[];
  readonly signal?: AbortSignal;
};

/** Shared shape of every aspect-specific repair surface (`repair.minecraft`, `.fabric`, …). */
export type RepairAspect = {
  plan(target: Target, options: RepairPlanOptions): Promise<RepairPlan>;
  run(plan: RepairPlan, options?: OperationOptions): Promise<RepairReport>;
};
