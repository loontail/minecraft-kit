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
- **`UpdatePlan.target`** widened to `InstallPlanTarget` for compatibility with the install
  runner.
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
