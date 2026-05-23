# Limitations

## Forge legacy (≤ 1.12.2) is not implemented

The kit supports **modern Forge only** (1.13+). The legacy Forge install flow (universal
JAR + `FMLTweaker`) needs its own metadata parsing, classpath layout, and tweaker
arguments and is not in scope today.

If you call `kit.versions.forge.list()` for a 1.12.2 build the entry will appear, but
attempting to install it will fail because the kit cannot find a modern
`install_profile.json` inside the installer JAR.

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
