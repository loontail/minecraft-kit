# Changelog

All notable changes to `@loontail/minecraft-kit` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.7.0] - 2026-05-22

### BREAKING CHANGES

- **Authentication.** Removed the Microsoft device-code sign-in flow:
  `kit.auth.login()`, `kit.auth.deviceCode.start()`, `kit.auth.deviceCode.poll()`,
  and the `DeviceCodePrompt`, `DeviceCodeState`, `LoginOptions`,
  `StartDeviceCodeOptions`, `PollDeviceCodeOptions` types. Error codes
  `AUTH_DEVICE_CODE_EXPIRED`, `AUTH_DEVICE_CODE_DECLINED`, and
  `AUTH_DEVICE_CODE_FAILED` are gone too. Migrate to
  `kit.auth.authorizationCode.run({ onOpenBrowser })` — see
  [docs/guides/auth](https://loontail.github.io/minecraft-kit/guides/auth).
- **Runtime install.** Removed the unused `lzma` package dependency, the
  `decodeLzma` helper, and the ambient `declare module "lzma"` shim. The kit
  downloads runtime files from the raw URL only; the optional LZMA1 sidecar
  advertised by Mojang's runtime index is ignored. Error code
  `LZMA_DECODE_ERROR` is removed because it can no longer be thrown.
- **Dead `ProgressEvent` arms pruned.** Two event kinds had no emit site in
  `src/`: `verify:completed` (no producer at all) and `repair:phase-changed`
  (the repair runner never emitted phase events; only the CLI progress
  renderer listened). Both arms — and the corresponding `EventTypes.VERIFY_COMPLETED`
  / `EventTypes.REPAIR_PHASE_CHANGED` registry entries — are removed.
  Consumers' exhaustive `switch (event.type)` over `ProgressEvent` will now
  compile without the removed cases.
- **Runtime-install input narrowed.** `PlanRuntimeInstallInput` is no longer
  re-exported (the kit's `kit.install.runtime.plan(target, opts)` hides it).
  `PlanStandaloneRuntimeInstallInput` stays public — the kit's
  `kit.install.runtime.standalonePlan` advertises it through
  `Omit<PlanStandaloneRuntimeInstallInput, "http" | "cache">`, so the public
  name is load-bearing.
- **Verify input types narrowed.** `VerifyFabricInput`, `VerifyForgeInput`,
  `VerifyMinecraftInput`, and `VerifyRuntimeInput` are no longer re-exported.
  All four describe the kit-built `{ target, http, cache, signal?, onEvent? }`
  shape that `kit.verify.<aspect>.run` wraps; consumers calling the
  documented standalone helpers (`verifyMinecraft`, etc.) can write the
  shape inline or recover it via `Parameters<typeof verifyMinecraft>[0]`.
  The functions themselves stay public.
- **Repair input types narrowed.** `PlanFabricRepairInput`,
  `PlanForgeRepairInput`, `PlanMinecraftRepairInput`, `PlanRuntimeRepairInput`,
  and `RunRepairInput` are no longer re-exported. All five are aliases over
  shapes already accessible via the kit facade (`kit.repair.<aspect>.plan`
  / `.run`) or via the public `AspectRepairInput` type. The functions
  themselves (`planMinecraftRepair`, `runRepair`, etc.) stay public as
  documented standalone escape hatches.
- **Repair surface narrowed.** `RepairAllInput` is no longer re-exported.
  `kit.repair.all(target, options)` is the documented entry point and the
  input shape is an implementation detail. `RepairAllReport` (the return
  type) stays public.
- **Versions surface narrowed.** `ResolverContext` is no longer re-exported.
  It's a DI bundle (`http` + `cache` + `logger`) the `MinecraftKit` constructor
  builds for its own `*VersionsApi` instances — consumers do not construct
  versions APIs directly.
- **Update API removed.** `kit.update.plan()` / `kit.update.run()` and the
  `UpdatePlan` / `UpdateReport` types are gone. The implementation forwarded
  directly to `planInstall` / `runInstall`; the install runner already skips
  files whose on-disk size and SHA-1 match the manifest, so a no-op update is
  the same call as an install. Migrate:

  ```ts
  // Before
  const plan = await kit.update.plan(target);
  const report = await kit.update.run(plan);

  // After
  const plan = await kit.install.plan(target);
  const report = await kit.install.run(plan);
  ```

  `InstallReport.actionsSkipped` carries the same per-action skip count
  `UpdateReport.actionsSkipped` did.
- **Auth surface narrowed.** `fetchMinecraftProfile` and `MinecraftProfile`
  are no longer re-exported from `@loontail/minecraft-kit`. The `MojangSession`
  returned by `kit.auth.authorizationCode.run()` and `kit.auth.refresh()`
  already carries the profile data (`session.minecraft.username`, `.uuid`,
  `.skins`, `.capes`) — fetch it from there instead.
- **Public type surface narrowed.** `src/index.ts` no longer re-exports
  `./constants/*` or `./types/*` through `export *` barrels. Re-exports are now an
  explicit, audited list. The following names are no longer part of the published
  API: every constant under `src/constants/` (HTTP timeouts and retries, cache
  defaults, JVM args, extraction limits, Maven base URLs, launch placeholders,
  platform mappings, runtime fallback, `ApiEndpoints`), plus the types
  `AssetIndexDocument`, `AssetObject`, `FabricCompatibilityEntry`,
  `ForgeInstallProfile`, `ForgeProcessor`, `ForgeProfileData`, `ForgeVersionJson`,
  `RuntimeFileDirectory`, `RuntimeFileEntry`, `RuntimeFileFile`, `RuntimeFileLink`,
  `RuntimeFilesManifest`, `RuntimeIndex`, `RuntimeIndexEntry`, and
  `RuntimeIndexPlatform`. Consumers that need any of these should inline the shape
  locally or file an issue.

### Added

- **Authentication.** `MojangAuthApi` plus the underlying Microsoft Authorization
  Code + PKCE loopback, Xbox/XSTS, and Minecraft modules. CLI scenario `mckit login`
  wires the flow with prompts that include precise error hints for the most common
  Azure / Mojang misconfigurations.
  (`feat(auth): add Microsoft OAuth login flow and CLI scenario`)
- **`core/abort.ts`** — `assertNotAborted()` + `checkpoint()` helpers so every long-running
  stage uses the same signal-check / pause-await / signal-check-again dance.
- **`core/assert-never.ts`** — exhaustiveness sentinel for discriminated unions.
- **`core/guards.ts`** — runtime shape predicates (`isPlainObject`, `isNonEmptyString`,
  `isArtifactDownload`, `isMinecraftVersionManifestShape`, …) for validating untrusted JSON
  at boundaries without pulling in Zod.
- **`core/json.ts`** — `parseJsonStrict` / `parseJsonAs` / `parseJsonOrUndefined` helpers
  that wrap `JSON.parse` failures into `MinecraftKitError` with context.
- **`scopedLogger(base, scope, baseFields?)`** in `core/logger` for module-scoped
  log prefixes, mirroring the launcher's convention.
- **`buildAuthLogger()`** routes auth-flow tracing through the kit's `Logger` interface
  (with an env-toggled console fallback) instead of raw stderr.
- **Manifest shape validation.** `versions/minecraft.resolve()` passes the raw response
  through `isMinecraftVersionManifestShape` and throws `MANIFEST_INVALID` with the URL on
  shape mismatch.
- **`downloadFile.hostAllowList`** — optional `readonly string[]` that pins downloads to a
  caller-supplied set of hosts (supports wildcard labels like `*.minecraft.net`). Adds a
  defense-in-depth layer on top of the existing http(s) scheme allow-list.
- **`scopedLogger`, `assertNever`** exported from the public API surface.
- **Auth tests.** 30 tests across `microsoft`, `xbox`, `minecraft`, and `MojangAuthApi`
  (login pipeline, refresh, missing-client-id, error-message hints).
- **Guards tests, JSON helpers tests, openBrowser tests, download URL-guard tests** —
  +44 tests overall, taking the suite from 294 → 356 passing.

### Changed

- **TypeScript strictness.** `tsconfig.json` now sets `exactOptionalPropertyTypes: true`
  on top of the existing `strict + noUncheckedIndexedAccess + noImplicitOverride`.
- **Lint strictness.** Biome rules `style.noNonNullAssertion` and
  `nursery.noNestedTernary` now error.
- **Code style.** All 255 top-level `function` declarations across `src/` + `tests/` are
  arrow functions; generators and class methods unchanged.
- **Type aliases.** 174 plain `interface` declarations migrated to `type`. The 5 that use
  `extends` remain `interface`.
- **`InstallPlan.target`** typed as `InstallPlanTarget = Target | RuntimeOnlyInstallTarget`.
  Replaces the `as unknown as Target` placeholder in `planStandaloneRuntimeInstall`.
- **`install/runner.ts`** split into focused stage functions (`runDownloadsStage`,
  `runWritesStage`, `runNativesStage`, `runRuntimeStage`, `runProcessorsStage`) backed by
  an `InstallRunnerContext`. `runProcessor` extracted to `install/processor.ts`.
- **`cli/scenarios/pickers.ts`** (458 LOC) split into `pickers/{version,loader,runtime,
  target}.ts` with a barrel `pickers/index.ts`.
- **`auth/microsoft`, `auth/xbox`, `auth/minecraft`** — `as { signal?: AbortSignal }`
  mutation casts replaced with project-standard conditional-spread.
- **`http/download.downloadFile`** rejects non-`http(s)` schemes and unparseable URLs at
  the boundary (closes manifest-injection class).
- **`cli/open-browser`** rejects non-`http(s)` URLs before spawning `cmd /c start`.
- **`targets.create`** requires an absolute `directory`.
- **`core/hash.sha1OfFile`** wraps the read stream in `try/finally` + `destroy()`.
- **`launch/spawner`** clears its listener set on stream `end` to avoid retaining
  subscriber closures past the producer's lifetime.
- **`src/index.ts`** exports regrouped by domain with section headers.
- **`cli/progress`** drops two non-null assertions in favour of explicit undefined checks.

### Removed

- Duplicate `LICENSE.md` (project keeps `LICENSE`).
- Several stray empty files at the repo root (`composition`, etc.).

### Notes

The kit deliberately ships without Zod — `core/guards.ts` covers the same boundary
validation niche while keeping the runtime dependency surface flat. Public auth APIs do
not log by default; pass a `Logger` to surface trace output or set
`MINECRAFT_KIT_AUTH_DEBUG=1` for stderr fallback.

## [0.6.0] — 2026-05-11

Earlier history is recorded in git. Highlights of pre-0.6 work:

- Dual CommonJS + ESM package builds.
- Installer update flow.
- Migration from pnpm to npm.
- Forge installation compatibility improvements and CLI error handling.
- GitHub Pages docs site.
