# Enums and types

Public types live under `src/types/`. The barrel `src/types/index.ts` re-exports them; the
package's `index.ts` re-exports the barrel.

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
| `LogLevels` | `DEBUG` `INFO` `WARN` `ERROR` |

## Profile literal types

These are plain string-literal unions (not `as const` maps), used by the
[skins API](./skins):

| Type | Values |
|---|---|
| `MojangSkinVariant` | `"CLASSIC"` `"SLIM"` |
| `MojangAssetState` | `"ACTIVE"` `"INACTIVE"` |

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

A `switch` on the discriminator gives you exhaustiveness checking — TypeScript will tell you
if you forgot a case.

The [API reference](../api/) has the full shape of every interface and field.
