import type { ResolvedRuntime, RuntimeFilesManifest } from "./runtime";
import type { Target } from "./target";

/**
 * Coarse-grained install phases. Used in `install:phase-changed` events so consumers can
 * render a progress bar with named steps.
 *
 * @example
 * ```ts
 * import { EventTypes, InstallPhases } from "@loontail/minecraft-kit";
 *
 * await kit.install.run(plan, {
 *   onEvent: (e) => {
 *     if (e.type !== EventTypes.INSTALL_PHASE_CHANGED) return;
 *     if (e.phase === InstallPhases.DOWNLOADING_ASSETS) setStatus("Downloading assets…");
 *     if (e.phase === InstallPhases.COMPLETED) setStatus("Done");
 *   },
 * });
 * ```
 */
export const InstallPhases = {
  PLANNING: "planning",
  DOWNLOADING_VERSION_MANIFEST: "downloading-version-manifest",
  DOWNLOADING_CLIENT_JAR: "downloading-client-jar",
  DOWNLOADING_LIBRARIES: "downloading-libraries",
  DOWNLOADING_ASSET_INDEX: "downloading-asset-index",
  DOWNLOADING_ASSETS: "downloading-assets",
  EXTRACTING_NATIVES: "extracting-natives",
  INSTALLING_RUNTIME: "installing-runtime",
  INSTALLING_FABRIC: "installing-fabric",
  INSTALLING_FORGE: "installing-forge",
  RUNNING_FORGE_PROCESSORS: "running-forge-processors",
  WRITING_FILES: "writing-files",
  COMPLETED: "completed",
} as const;

/**
 * Install phase literal.
 *
 * @example
 * ```ts
 * import { InstallPhases, type InstallPhase } from "@loontail/minecraft-kit";
 *
 * const isRuntimePhase = (phase: InstallPhase) => phase === InstallPhases.INSTALLING_RUNTIME;
 * ```
 */
export type InstallPhase = (typeof InstallPhases)[keyof typeof InstallPhases];

/**
 * Action kinds inside an {@link InstallPlan}.
 *
 * @example
 * ```ts
 * import { assertNever, InstallActionKinds, type InstallAction } from "@loontail/minecraft-kit";
 *
 * const label = (a: InstallAction) => {
 *   switch (a.kind) {
 *     case InstallActionKinds.DOWNLOAD_FILE: return `GET ${a.url}`;
 *     case InstallActionKinds.EXTRACT_NATIVE: return `unzip ${a.source}`;
 *     case InstallActionKinds.RUN_FORGE_PROCESSOR: return `forge ${a.index}`;
 *     case InstallActionKinds.WRITE_VERSION_JSON:
 *     case InstallActionKinds.WRITE_LOGGING_CONFIG: return `write ${a.path}`;
 *     default: return assertNever(a);
 *   }
 * };
 * ```
 */
export const InstallActionKinds = {
  DOWNLOAD_FILE: "download-file",
  EXTRACT_NATIVE: "extract-native",
  RUN_FORGE_PROCESSOR: "run-forge-processor",
  WRITE_VERSION_JSON: "write-version-json",
  WRITE_LOGGING_CONFIG: "write-logging-config",
} as const;

/**
 * Discriminator for an install action.
 *
 * @example
 * ```ts
 * import { InstallActionKinds, type InstallActionKind } from "@loontail/minecraft-kit";
 *
 * const isDownload = (kind: InstallActionKind) => kind === InstallActionKinds.DOWNLOAD_FILE;
 * ```
 */
export type InstallActionKind = (typeof InstallActionKinds)[keyof typeof InstallActionKinds];

/**
 * Categorisation tag on every {@link DownloadAction}. Drives the install-phase mapping
 * and lets consumers filter the plan to a subset (e.g. "runtime only").
 *
 * @example
 * ```ts
 * import { DownloadCategories } from "@loontail/minecraft-kit";
 *
 * await kit.install.run(plan, {
 *   actionCategories: new Set([DownloadCategories.ASSET, DownloadCategories.ASSET_INDEX]),
 * });
 * ```
 */
export const DownloadCategories = {
  CLIENT_JAR: "client-jar",
  LIBRARY: "library",
  ASSET_INDEX: "asset-index",
  ASSET: "asset",
  LOGGING_CONFIG: "logging-config",
  FABRIC_LIBRARY: "fabric-library",
  FORGE_LIBRARY: "forge-library",
  RUNTIME_FILE: "runtime-file",
  FORGE_INSTALLER: "forge-installer",
} as const;

/**
 * Download category literal — drives `runInstall` phase boundaries.
 *
 * @example
 * ```ts
 * import { DownloadCategories, type DownloadCategory } from "@loontail/minecraft-kit";
 *
 * const stageOf = (c: DownloadCategory): string =>
 *   c === DownloadCategories.RUNTIME_FILE ? "java" : "game";
 * ```
 */
export type DownloadCategory = (typeof DownloadCategories)[keyof typeof DownloadCategories];

/**
 * A single download step.
 *
 * `url` accepts either a single string or a `readonly string[]` of mirror URLs that the
 * runner tries in order. Each URL gets a full retry budget; the next URL is only
 * consulted when the previous one's retries are exhausted. Pass a single string for the
 * common single-source case — the runner will treat it identically to a one-element
 * array. For display, use the first array entry; progress events report the URL currently
 * being fetched.
 *
 * @example
 * ```ts
 * import { InstallActionKinds, type DownloadAction } from "@loontail/minecraft-kit";
 *
 * const downloads = plan.actions.filter(
 *   (a): a is DownloadAction => a.kind === InstallActionKinds.DOWNLOAD_FILE,
 * );
 * const totalBytes = downloads.reduce((sum, a) => sum + (a.expectedSize ?? 0), 0);
 * ```
 */
export type DownloadAction = {
  readonly kind: typeof InstallActionKinds.DOWNLOAD_FILE;
  readonly url: string | readonly string[];
  readonly target: string;
  readonly expectedSha1?: string;
  readonly expectedSize?: number;
  readonly category: DownloadCategory;
};

/**
 * A native extraction step. Source jar must already exist on disk.
 *
 * @example
 * ```ts
 * import { InstallActionKinds, type ExtractNativeAction } from "@loontail/minecraft-kit";
 *
 * const extracts = plan.actions.filter(
 *   (a): a is ExtractNativeAction => a.kind === InstallActionKinds.EXTRACT_NATIVE,
 * );
 * for (const e of extracts) console.log(`unzip ${e.source} → ${e.destination}`);
 * ```
 */
export type ExtractNativeAction = {
  readonly kind: typeof InstallActionKinds.EXTRACT_NATIVE;
  readonly source: string;
  readonly destination: string;
  readonly exclude: readonly string[];
};

/**
 * A Forge processor invocation. `Main-Class` is intentionally NOT carried here — the
 * runner reads it from `classpath[0]`'s manifest at execution time, because the JAR is
 * not guaranteed to exist on disk during planning (newer Forge versions ship some
 * processor JARs as regular Maven libraries instead of bundling them in the installer).
 *
 * @example
 * ```ts
 * import { InstallActionKinds, type RunForgeProcessorAction } from "@loontail/minecraft-kit";
 *
 * const processors = plan.actions.filter(
 *   (a): a is RunForgeProcessorAction => a.kind === InstallActionKinds.RUN_FORGE_PROCESSOR,
 * );
 * console.log(`forge install will invoke ${processors.length} processors`);
 * ```
 */
export type RunForgeProcessorAction = {
  readonly kind: typeof InstallActionKinds.RUN_FORGE_PROCESSOR;
  readonly index: number;
  /** First entry is the processor JAR; remaining entries are its declared classpath. */
  readonly classpath: readonly string[];
  readonly args: readonly string[];
  readonly outputs: Readonly<Record<string, string>>;
};

/**
 * Write a version JSON to disk (Fabric / Forge).
 *
 * @example
 * ```ts
 * import { InstallActionKinds, type WriteVersionJsonAction } from "@loontail/minecraft-kit";
 *
 * const writes = plan.actions.filter(
 *   (a): a is WriteVersionJsonAction => a.kind === InstallActionKinds.WRITE_VERSION_JSON,
 * );
 * for (const w of writes) console.log(`will write ${w.path} (${w.content.length} bytes)`);
 * ```
 */
export type WriteVersionJsonAction = {
  readonly kind: typeof InstallActionKinds.WRITE_VERSION_JSON;
  readonly path: string;
  readonly content: string;
};

/**
 * Write a logging config (log4j XML) to disk.
 *
 * @example
 * ```ts
 * import { InstallActionKinds, type WriteLoggingConfigAction } from "@loontail/minecraft-kit";
 *
 * const logConfigs = plan.actions.filter(
 *   (a): a is WriteLoggingConfigAction => a.kind === InstallActionKinds.WRITE_LOGGING_CONFIG,
 * );
 * ```
 */
export type WriteLoggingConfigAction = {
  readonly kind: typeof InstallActionKinds.WRITE_LOGGING_CONFIG;
  readonly path: string;
  readonly content: string;
};

/**
 * Discriminated union of install actions.
 *
 * @example
 * ```ts
 * import { InstallActionKinds, type InstallAction } from "@loontail/minecraft-kit";
 *
 * const onlyDownloads = (actions: readonly InstallAction[]): readonly InstallAction[] =>
 *   actions.filter((a) => a.kind === InstallActionKinds.DOWNLOAD_FILE);
 * ```
 */
export type InstallAction =
  | DownloadAction
  | ExtractNativeAction
  | RunForgeProcessorAction
  | WriteVersionJsonAction
  | WriteLoggingConfigAction;

/**
 * A "runtime-only" install plan target. Used by `planStandaloneRuntimeInstall` to plan a
 * JRE-only install without a Minecraft version/loader pinned to the plan.
 *
 * @example
 * ```ts
 * import type { RuntimeOnlyInstallTarget } from "@loontail/minecraft-kit";
 *
 * const plan = await kit.install.runtime.standalonePlan({ id, directory, runtime });
 * const target = plan.target as RuntimeOnlyInstallTarget;
 * console.log(target.runtime.component); // → e.g. "java-runtime-gamma"
 * ```
 */
export type RuntimeOnlyInstallTarget = {
  readonly id: string;
  readonly directory: string;
  readonly runtime: ResolvedRuntime;
  readonly minecraft?: undefined;
  readonly loader?: undefined;
};

/**
 * Shape of `InstallPlan.target`. Either a fully-resolved `Target` (from `./target`) or a
 * runtime-only stand-in. The install runner only reads `target.minecraft`/`target.loader` when
 * the plan actually contains those steps, so runtime-only plans are safe.
 *
 * @example
 * ```ts
 * import type { InstallPlanTarget } from "@loontail/minecraft-kit";
 *
 * const directoryOf = (t: InstallPlanTarget): string => t.directory;
 * console.log(directoryOf(plan.target));
 * ```
 */
export type InstallPlanTarget = Target | RuntimeOnlyInstallTarget;

/**
 * Pre-computed install plan: a flat ordered list of actions plus computed totals.
 *
 * The runner consumes this; the plan carries a reference to the resolved target so the
 * runner does not need a second target argument.
 *
 * Planning is side-effect-free for vanilla and Fabric. **Forge is the exception**: planning a
 * Forge target downloads the installer JAR and extracts its embedded Maven artifacts to
 * `libraries/`, because the per-library/processor actions can only be enumerated after
 * reading the installer's `install_profile.json` from disk. Treat `install.plan(forgeTarget)`
 * as requiring network + disk, not a pure dry-run.
 *
 * @example
 * ```ts
 * import type { InstallPlan } from "@loontail/minecraft-kit";
 *
 * const plan: InstallPlan = await kit.install.plan(target);
 * console.log(`${plan.totalActions} actions, ${(plan.totalBytes / 1e6).toFixed(1)} MB`);
 * const report = await kit.install.run(plan);
 * ```
 */
export type InstallPlan = {
  readonly targetId: string;
  readonly directory: string;
  readonly target: InstallPlanTarget;
  readonly actions: readonly InstallAction[];
  readonly totalBytes: number;
  readonly totalActions: number;
  /**
   * Java runtime files manifest resolved during planning, when the plan includes a runtime.
   * Carried so the runner can materialize directory/symlink/executable entries without a
   * second fetch of the same manifest.
   */
  readonly runtimeManifest?: RuntimeFilesManifest;
};

/**
 * Outcome summary returned by `install.run`.
 *
 * @example
 * ```ts
 * import type { InstallReport } from "@loontail/minecraft-kit";
 *
 * const report: InstallReport = await kit.install.run(plan);
 * console.log(
 *   `${report.actionsCompleted} done, ${report.actionsSkipped} skipped in ${report.durationMs}ms`,
 * );
 * ```
 */
export type InstallReport = {
  readonly targetId: string;
  readonly bytesDownloaded: number;
  readonly actionsCompleted: number;
  readonly actionsSkipped: number;
  readonly durationMs: number;
};
