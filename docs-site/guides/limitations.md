# Limitations

## Forge legacy support is narrow

The kit supports processor-based Forge installer profiles and the legacy Forge installer
profile used by 1.7.x-era installers: `install.versionInfo` plus an embedded universal JAR
referenced by `install.filePath`. Other historical Forge installer shapes should be treated
as unsupported until a real installer fixture is added for them.

## NeoForge is not implemented

NeoForge's installer uses a slightly different profile schema. No resolver consumes it
yet.

## Optional Forge processor outputs

Some early 1.13.x Forge installers declare an empty `outputs` map per processor. The kit
verifies declared outputs by SHA-1; processors that succeed but produce no `outputs`
entry are trusted by their exit code only. This matches the official installer's
behaviour.

## Known event-stream quirks

- `download:started.expectedSize` and `download:progress.totalBytes` are `0` when the
  manifest does not declare a size and the server does not return `content-length`. Treat
  zero as "unknown" in renderers — see [events](./events).
- The runtime "latest across components" fallback in `kit.versions.runtime.resolve` only
  fires when `preference: RuntimePreference.LATEST` is set explicitly.
