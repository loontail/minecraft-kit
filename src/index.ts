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
export type { ResolverContext } from "./versions/context";

// ─────────────────────────────────────────────────────────────────────────────────────
// Install — plan a runtime/standalone install + observe progress
// ─────────────────────────────────────────────────────────────────────────────────────
export {
  planRuntimeInstall,
  planStandaloneRuntimeInstall,
  type PlanRuntimeInstallInput,
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
export {
  type VerifyFabricInput,
  type VerifyForgeInput,
  verifyFabric,
  verifyForge,
  verifyMinecraft,
  type VerifyMinecraftInput,
  verifyRuntime,
  type VerifyRuntimeInput,
} from "./verify/index";
export {
  planFabricRepair,
  planForgeRepair,
  planMinecraftRepair,
  type PlanFabricRepairInput,
  type PlanForgeRepairInput,
  type PlanMinecraftRepairInput,
  type PlanRuntimeRepairInput,
  planRuntimeRepair,
  type RepairAllInput,
  type RepairAllReport,
  repairAll,
  type RunRepairInput,
  runRepair,
} from "./repair/index";

// ─────────────────────────────────────────────────────────────────────────────────────
// Launch — resolve the on-disk version JSON before composing JVM args
// ─────────────────────────────────────────────────────────────────────────────────────
export {
  pickClientJarVersionId,
  resolveLaunchVersion,
  type ResolvedLaunchVersion,
} from "./launch/version-resolution";
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
export { fetchMinecraftProfile, type MinecraftProfile } from "./auth/minecraft";

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
// Public type surface (events, manifests, error codes, enums, etc.)
// ─────────────────────────────────────────────────────────────────────────────────────
export * from "./constants/index";
export * from "./types/index";
