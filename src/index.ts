// Public API of @loontail/minecraft-kit. Exports are grouped by concern; consumers should
// import what they need from `@loontail/minecraft-kit` directly. The `./cli` entry point
// is a separate binary and is NOT re-exported here.
//
// Stability: any name re-exported below is part of the published API surface and is
// covered by semver. Names not re-exported here are internal and may change between
// patch releases.

// ─────────────────────────────────────────────────────────────────────────────────────
// Kit entry point + composed API
// ─────────────────────────────────────────────────────────────────────────────────────
export { MinecraftKit } from "./kit";
export type {
  InstallRunOptions,
  MinecraftKitOptions,
  RepairAspect,
  RepairPlanOptions,
  VerifyOperationOptions,
} from "./kit";

// ─────────────────────────────────────────────────────────────────────────────────────
// Errors + error codes (single error class for every public API)
// ─────────────────────────────────────────────────────────────────────────────────────
export {
  isErrorCode,
  isMinecraftKitError,
  MinecraftKitError,
  MinecraftKitErrorCodes,
} from "./core/errors";
export { assertNever } from "./core/assert-never";

// ─────────────────────────────────────────────────────────────────────────────────────
// Targets — resolve, list, and validate a Minecraft + loader + runtime triple
// ─────────────────────────────────────────────────────────────────────────────────────
export { TargetsApi } from "./targets/index";
export type {
  TargetListInput,
  TargetLoaderInput,
  TargetResolveInput,
  TargetsApiContext,
} from "./targets/index";

// ─────────────────────────────────────────────────────────────────────────────────────
// Versions APIs (Minecraft / Fabric / Forge / Java runtime)
// ─────────────────────────────────────────────────────────────────────────────────────
export { FabricVersionsApi } from "./versions/fabric";
export type { FabricListInput, FabricResolveInput } from "./versions/fabric";
export { ForgeVersionsApi } from "./versions/forge";
export type { ForgeListInput, ForgeResolveInput } from "./versions/forge";
export { MinecraftVersionsApi } from "./versions/minecraft";
export type {
  MinecraftGetInput,
  MinecraftLatestInput,
  MinecraftListInput,
} from "./versions/minecraft";
export { RuntimeVersionsApi } from "./versions/runtime";
export type {
  RuntimeListEntry,
  RuntimeListInput,
  RuntimeResolveInput,
} from "./versions/runtime";

// ─────────────────────────────────────────────────────────────────────────────────────
// Install — plan a runtime/standalone install + observe progress
// ─────────────────────────────────────────────────────────────────────────────────────
export {
  planRuntimeInstall,
  planStandaloneRuntimeInstall,
  type PlanStandaloneRuntimeInstallInput,
} from "./install/runtime-install";
export {
  createInstallProgressTracker,
  InstallStages,
  type InstallProgressTracker,
  type InstallStage,
  type ProgressSnapshot,
  type ProgressTrackerOptions,
} from "./install/progress-tracker";

// ─────────────────────────────────────────────────────────────────────────────────────
// Verify + repair — detect missing/corrupt files and re-derive an install plan
// ─────────────────────────────────────────────────────────────────────────────────────
export { verifyFabric, verifyForge, verifyMinecraft, verifyRuntime } from "./verify/index";
export {
  planFabricRepair,
  planForgeRepair,
  planMinecraftRepair,
  planRuntimeRepair,
  type RepairAllReport,
  repairAll,
  runRepair,
} from "./repair/index";

// ─────────────────────────────────────────────────────────────────────────────────────
// Launch — resolve the on-disk version JSON before composing JVM args
// ─────────────────────────────────────────────────────────────────────────────────────
export { resolveLaunchVersion, type ResolvedLaunchVersion } from "./launch/version-resolution";
export { ChildProcessSpawner } from "./launch/spawner";

// ─────────────────────────────────────────────────────────────────────────────────────
// Authentication — Microsoft OAuth Authorization Code + PKCE → Xbox → Minecraft
// ─────────────────────────────────────────────────────────────────────────────────────
export {
  type AuthorizationCodeRunOptions,
  CLIENT_ID_ENV_VAR,
  MojangAuthApi,
  type RefreshOptions,
  toOnlineAuth,
} from "./auth/index";

// ─────────────────────────────────────────────────────────────────────────────────────
// HTTP + cache abstractions consumers plug into MinecraftKit
// ─────────────────────────────────────────────────────────────────────────────────────
export { createMemoryCache } from "./http/cache";
export type { MemoryCacheOptions } from "./http/cache";
export { FetchHttpClient } from "./http/client";

// ─────────────────────────────────────────────────────────────────────────────────────
// Utilities — loggers, system detection, path layout, pause control, UUID helpers
// ─────────────────────────────────────────────────────────────────────────────────────
export { consoleLogger, scopedLogger, silentLogger } from "./core/logger";
export { detectSystem } from "./core/system";
export type { DetectSystemInput } from "./core/system";
export { offlineUuidFor, stripUuidDashes } from "./core/uuid";
export { targetPaths } from "./core/paths";
export { PauseController } from "./core/pause-controller";

// ─────────────────────────────────────────────────────────────────────────────────────
// Public type surface (events, manifests, error codes, enums, etc.).
//
// Re-exports below are listed explicitly, grouped by source file, alphabetised by name.
// Names not listed here are internal and may change without notice. Constants under
// `src/constants/` (HTTP timeouts, JVM args, Maven base URLs, etc.) are intentionally
// internal and are not part of the published surface.
// ─────────────────────────────────────────────────────────────────────────────────────
export {
  type AuthMode,
  AuthModes,
  type LaunchAuth,
  type MojangAssetState,
  type MojangProfileCape,
  type MojangProfileSkin,
  type MojangSession,
  type MojangSkinVariant,
  type OfflineAuth,
  type OnlineAuth,
} from "./types/auth";
export type { MetadataCache } from "./types/cache";
export type { MinecraftKitErrorContext } from "./types/errors";
export {
  type EventType,
  EventTypes,
  type FileRef,
  type OperationOptions,
  type ProcessorRef,
  type ProgressEvent,
  type ProgressListener,
} from "./types/events";
export type {
  FabricLoaderSummary,
  FabricProfile,
  ResolvedFabricLoader,
} from "./types/fabric";
export type { ForgeBuildSummary, ResolvedForgeLoader } from "./types/forge";
export type {
  HttpClient,
  HttpHeaders,
  HttpMethod,
  HttpRequestBody,
  HttpRequestOptions,
  HttpResponse,
} from "./types/http";
export {
  type DownloadAction,
  DownloadCategories,
  type DownloadCategory,
  type ExtractNativeAction,
  type InstallAction,
  type InstallActionKind,
  InstallActionKinds,
  type InstallPhase,
  InstallPhases,
  type InstallPlan,
  type InstallPlanTarget,
  type InstallReport,
  type RunForgeProcessorAction,
  type RuntimeOnlyInstallTarget,
  type WriteLoggingConfigAction,
  type WriteVersionJsonAction,
} from "./types/install";
export type {
  LaunchComposition,
  LaunchExit,
  LaunchMemoryOptions,
  LaunchOptions,
  LaunchResolutionOptions,
  LaunchRunOptions,
  LaunchSession,
} from "./types/launch";
export {
  type Loader,
  type LoaderKind,
  Loaders,
  VersionPreference,
  type VersionPreferenceKind,
} from "./types/loader";
export { type LogLevel, LogLevels, type Logger } from "./types/logger";
export {
  type ArgumentEntry,
  type ArtifactDownload,
  type AssetIndexReference,
  type LibraryArtifact,
  type LibraryRule,
  type MinecraftArguments,
  type MinecraftChannel,
  MinecraftChannels,
  type MinecraftDownloads,
  type MinecraftJavaVersion,
  type MinecraftLibrary,
  type MinecraftLibraryDownloads,
  type MinecraftLogging,
  type MinecraftVersionManifest,
  type MinecraftVersionSummary,
  type ResolvedMinecraft,
} from "./types/minecraft";
export {
  type AspectRepairInput,
  type RepairPhase,
  RepairPhases,
  type RepairPlan,
  type RepairReport,
} from "./types/repair";
export {
  type ResolvedRuntime,
  type RuntimeComponent,
  RuntimeComponents,
  RuntimePreference,
  type RuntimePreferenceKind,
} from "./types/runtime";
export type {
  ProcessStream,
  SpawnedProcess,
  SpawnOptions,
  Spawner,
} from "./types/spawner";
export {
  type Architecture,
  Architectures,
  type OperatingSystem,
  OperatingSystems,
  type RuntimeSystem,
} from "./types/system";
export type {
  DiscoveredLoaderHint,
  DiscoveredRuntimeHint,
  DiscoveredTarget,
  Target,
  TargetCreateInput,
} from "./types/target";
export type { ResolvedVanillaLoader } from "./types/vanilla";
export {
  type VerificationFileResult,
  type VerificationKind,
  VerificationKinds,
  type VerificationResult,
  VerifyFileCategories,
  type VerifyFileCategory,
  type VerifyFileStatus,
  VerifyFileStatuses,
} from "./types/verify";
