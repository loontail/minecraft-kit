# Constants reference

Every URL and tunable number lives in `src/constants/`. Code never hard-codes either — call
sites import from these modules.

## API endpoints

```ts
import { ApiEndpoints } from "@loontail/minecraft-kit";

ApiEndpoints.mojang.versionManifest();        // version_manifest_v2.json
ApiEndpoints.mojang.runtimeIndex();           // java-runtime/.../all.json
ApiEndpoints.resources.asset(hash);           // asset object
ApiEndpoints.fabric.gameVersions();
ApiEndpoints.fabric.loaderVersions();
ApiEndpoints.fabric.loaderForGame(mc);
ApiEndpoints.fabric.profile(mc, loader);
ApiEndpoints.forge.mavenMetadata();
ApiEndpoints.forge.promotions();
ApiEndpoints.forge.installer(fullVersion);
```

## Defaults

| Constant | Value |
|---|---|
| `HTTP_TIMEOUT_MS` | `30_000` |
| `HTTP_RETRY_MAX` | `4` |
| `HTTP_RETRY_BACKOFF_BASE_MS` | `500` |
| `HTTP_RETRY_BACKOFF_CAP_MS` | `30_000` |
| `DOWNLOAD_CONCURRENCY` | `32` |
| `CACHE_TTL_MS` | `300_000` |
| `CACHE_MAX_ENTRIES` | `256` |
| `USER_AGENT` | `minecraft-kit/0.1` |
| `DEFAULT_LAUNCHER_NAME` | `minecraft-kit` |
| `DEFAULT_LAUNCHER_VERSION` | `0.1.0` |
| `DEFAULT_MIN_MB` | `1024` |
| `DEFAULT_MAX_MB` | `4096` |
| `DEFAULT_KILL_GRACE_MS` | `5_000` |
| `PROGRESS_EVENT_INTERVAL_MS` | `100` |
| `MAX_PROCESSOR_STDERR_LINES` | `20` |
| `SPAWNER_MAX_LINE_BYTES` | `65_536` |

## Layout segments

`src/constants/files.ts` exports the relative-path segments used by `targetPaths.*`:
`VERSIONS_DIR`, `LIBRARIES_DIR`, `ASSETS_DIR`, `ASSETS_OBJECTS_DIR`, `ASSETS_INDEXES_DIR`,
`ASSETS_VIRTUAL_DIR`, `ASSETS_LEGACY_DIR`, `ASSETS_RESOURCES_DIR`, `ASSETS_LOG_CONFIGS_DIR`,
`RUNTIMES_DIR`, `NATIVES_DIR_NAME`, `FORGE_INSTALLERS_DIR`, plus `JAVA_EXECUTABLE` and
`MAC_RUNTIME_PREFIX`.

## Archive limits

`src/constants/limits.ts` defines extraction caps that defeat zip-bombs and zip-slip:
`EXTRACTION_MAX_FILE_SIZE` (256 MiB), `EXTRACTION_MAX_TOTAL_SIZE` (2 GiB),
`EXTRACTION_MAX_COMPRESSION_RATIO` (200), `EXTRACTION_MAX_ENTRY_COUNT` (100 000),
`FORGE_INSTALLER_MAX_SIZE` (256 MiB).

## Placeholders

`src/constants/placeholders.ts` exports `LAUNCH_PLACEHOLDERS` — every `${...}` token used
during launch, with a one-line description per token.

## Discriminator registries (`as const`)

Every enum-like string is exposed as an `as const` object so call sites never inline the
literal. The derived union type is what TypeScript shows in signatures.

| Registry | Where | Used for |
|---|---|---|
| `MinecraftKitErrorCodes` | `core/errors` (re-exported from package root) | `new MinecraftKitError(MinecraftKitErrorCodes.X, ...)` and `isErrorCode(e, MinecraftKitErrorCodes.X)`. |
| `EventTypes` | `types/events` | `type: EventTypes.DOWNLOAD_STARTED` at every emit, `case EventTypes.DOWNLOAD_STARTED:` at every consumer. |
| `InstallActionKinds` | `types/install` | Discriminator on `InstallAction`. |
| `DownloadCategories` | `types/install` | `DownloadAction.category` values; install runner phase mapping. |
| `InstallPhases` | `types/install` | Phase argument of `install:phase-changed`. |
| `Loaders` | `types/loader` | `target.loader.type` values (`VANILLA`, `FABRIC`, `FORGE`). |
| `VersionPreference` | `types/loader` | `RECOMMENDED` vs `LATEST` when resolving Fabric/Forge. |
| `MinecraftChannels` | `types/minecraft` | `RELEASE`, `SNAPSHOT`, `OLD_BETA`, `OLD_ALPHA`. |
| `RuntimePreference` | `types/runtime` | Runtime version selection. |
| `VerifyFileCategories`, `VerifyFileStatuses` | `types/verify` | Per-file verification result. |
| `VerificationKinds` | `types/verify` | `VerificationResult.kind`. |
| `RepairPhases` | `types/repair` | Phase argument of `repair:phase-changed`. |
| `AuthModes` | `types/auth` | `OFFLINE` vs `ONLINE`. |
| `WizardOutcomes` | `cli/ui` | CLI picker `kind` values (`OK`, `BACK`, `CANCEL`). |
| `InstallWizardSteps`, `InstallRunResults` | `cli/scenarios/types` | CLI install wizard state machine. |
