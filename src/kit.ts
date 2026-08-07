/**
 * Single facade for the entire library. The constructor wires the four per-aspect
 * builders ({@link "./kit/install-aspect"}, {@link "./kit/verify-aspect"},
 * {@link "./kit/repair-aspect"}, {@link "./kit/launch-aspect"}) plus the versions /
 * targets / auth surfaces; the heavy lifting lives in the builders themselves.
 *
 * @packageDocumentation
 */

import { MojangAuthApi } from "./auth/index";
import { DEFAULT_DOWNLOAD_HOST_ALLOWLIST } from "./constants/api";
import { silentLogger } from "./core/logger";
import { detectSystem } from "./core/system";
import { createMemoryCache } from "./http/cache";
import { FetchHttpClient } from "./http/client";
import { buildInstallAspect, type InstallAspect } from "./kit/install-aspect";
import { buildLaunchAspect, type LaunchAspect } from "./kit/launch-aspect";
import { buildRepairAspect, type RepairSurface } from "./kit/repair-aspect";
import { buildVerifyAspect, type VerifyAspect } from "./kit/verify-aspect";
import { ChildProcessSpawner } from "./launch/spawner";
import { TargetsApi } from "./targets/index";
import type { MetadataCache } from "./types/cache";
import type { HttpClient } from "./types/http";
import type { Logger } from "./types/logger";
import type { Spawner } from "./types/spawner";
import type { RuntimeSystem } from "./types/system";
import { FabricVersionsApi } from "./versions/fabric";
import { ForgeVersionsApi } from "./versions/forge";
import { MinecraftVersionsApi } from "./versions/minecraft";
import { RuntimeVersionsApi } from "./versions/runtime";

export type { InstallAspect, InstallRunOptions } from "./kit/install-aspect";
export type { LaunchAspect } from "./kit/launch-aspect";
export type {
  RepairAllRunOptions,
  RepairAspectSurface,
  RepairRunOptions,
  RepairSurface,
} from "./kit/repair-aspect";
export type { VerifyAspect } from "./kit/verify-aspect";

/**
 * Constructor options for {@link MinecraftKit}.
 *
 * @example
 * ```ts
 * import { consoleLogger, MinecraftKit, type MinecraftKitOptions } from "@loontail/minecraft-kit";
 *
 * const options: MinecraftKitOptions = { logger: consoleLogger };
 * const kit = new MinecraftKit(options);
 * ```
 */
export type MinecraftKitOptions = {
  readonly httpClient?: HttpClient;
  readonly cache?: MetadataCache;
  readonly logger?: Logger;
  readonly system?: RuntimeSystem;
  readonly spawner?: Spawner;
  /**
   * Host allow-list applied to every install/repair file download. Download URLs come from
   * network-fetched manifests, so pinning them to a known set of hosts closes a supply-chain
   * MITM/manifest-rewrite vector. Defaults to {@link DEFAULT_DOWNLOAD_HOST_ALLOWLIST} (the
   * Mojang/Fabric/Forge ecosystem). Entries support a leading wildcard label, e.g.
   * `"*.minecraft.net"`. Pass a custom list to add a private mirror.
   */
  readonly hostAllowList?: readonly string[];
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
  readonly install: InstallAspect;
  readonly verify: VerifyAspect;
  readonly repair: RepairSurface;
  readonly launch: LaunchAspect;
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
    const hostAllowList = options.hostAllowList ?? DEFAULT_DOWNLOAD_HOST_ALLOWLIST;
    const ctx = { http, cache, logger };

    const minecraft = new MinecraftVersionsApi(ctx);
    const fabric = new FabricVersionsApi(ctx);
    const forge = new ForgeVersionsApi(ctx);
    const runtime = new RuntimeVersionsApi(ctx);
    this.versions = { minecraft, fabric, forge, runtime };
    this.targets = new TargetsApi({ minecraft, fabric, forge, runtime, system });
    this.auth = new MojangAuthApi(http, options.logger);
    this.cache = cache;

    this.install = buildInstallAspect({ http, cache, spawner, hostAllowList });
    this.verify = buildVerifyAspect({ http, cache });
    this.repair = buildRepairAspect({ http, cache, spawner, hostAllowList });
    this.launch = buildLaunchAspect({ spawner, logger });
  }
}
