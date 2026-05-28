# Enums and types

Import public types and const maps from `@loontail/minecraft-kit`. `src/index.ts` is the
only public entrypoint.

## Const enum maps

| Object | Values |
|---|---|
| `Loaders` | `VANILLA` `FABRIC` `FORGE` |
| `MinecraftChannels` | `RELEASE` `SNAPSHOT` `OLD_BETA` `OLD_ALPHA` |
| `VersionPreference` | `LATEST` `RECOMMENDED` |
| `RuntimePreference` | `RECOMMENDED` `LATEST` |
| `RuntimeComponents` | `JRE_LEGACY` `JAVA_RUNTIME_GAMMA` `JAVA_RUNTIME_DELTA` … |
| `VerificationKinds` | `MINECRAFT` `FABRIC` `FORGE` `RUNTIME` |
| `VerifyFileStatuses` | `OK` `MISSING` `CORRUPT` `WRONG_SIZE` |
| `VerifyFileCategories` | `CLIENT_JAR` `LIBRARY` `ASSET` `ASSET_INDEX` `NATIVE` `LOADER_LIBRARY` `RUNTIME_FILE` `LOGGING_CONFIG` |
| `InstallPhases` | `PLANNING` `DOWNLOADING_LIBRARIES` `WRITING_FILES` `EXTRACTING_NATIVES` `INSTALLING_RUNTIME` `RUNNING_FORGE_PROCESSORS` `COMPLETED` … |
| `InstallActionKinds` | `DOWNLOAD_FILE` `EXTRACT_NATIVE` `RUN_FORGE_PROCESSOR` `WRITE_VERSION_JSON` `WRITE_LOGGING_CONFIG` |
| `EventTypes` | One literal per `ProgressEvent.type` |
| `AuthModes` | `OFFLINE` `ONLINE` |
| `SkinVariants` | `CLASSIC` `SLIM` |
| `SkinVariantInputs` | `CLASSIC` `SLIM` `AUTO` |
| `MojangAssetStates` | `ACTIVE` `INACTIVE` |
| `LogLevels` | `DEBUG` `INFO` `WARN` `ERROR` |

```ts
import { Loaders, EventTypes, VerificationKinds } from "@loontail/minecraft-kit";

if (target.loader.type === Loaders.FABRIC) { /* narrows */ }

const result = await kit.verify.minecraft.run(target);
if (result.kind === VerificationKinds.MINECRAFT) { /* narrows */ }
```

## Discriminated unions

| Union | Discriminator |
|---|---|
| `Loader` | `type: Loaders.*` |
| `InstallAction` | `kind: InstallActionKinds.*` |
| `ProgressEvent` | `type: EventTypes.*` (string literal) |

A `switch` on the discriminator gives exhaustiveness checking.
