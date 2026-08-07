# Modules (internal)

Orientation for the modules whose ownership is not obvious from the filename, so you don't
have to grep for "where does X live". It is deliberately **not** a full file inventory —
per-file upkeep is what made the previous version drift. Every directory under `src/` has a
section here (`tests/docs-modules.test.ts` enforces that); within a section, self-describing
files may be summarised as a group.

## `src/index.ts`, `src/kit.ts`, `src/kit/`

- `index.ts` — the public surface. Explicit re-exports only, no `export *`; anything absent
  from here is internal and may be renamed without a release note.
- `kit.ts` — the `MinecraftKit` facade. Resolves every injectable dependency
  (`httpClient`, `cache`, `logger`, `system`, `spawner`, `hostAllowList`) to its default in
  the constructor and threads them into the four aspect builders.
- `kit/{install,verify,repair,launch}-aspect.ts` — one builder per `kit.<aspect>` surface.
  These are the only files that bind the injected dependencies to the standalone domain
  functions, so a new facade method is added here, not in `kit.ts`.

## `src/types/`

Public type declarations plus the `as const` discriminator maps they derive from
(`InstallActionKinds`, `DownloadCategories`, `EventTypes`, `Loaders`, `VerifyFileStatuses`,
`InstallPhases`, `MinecraftKitErrorCodes`, …). One file per domain, named after it. Types
consumed by exactly one internal module stay co-located with that module instead.

## `src/constants/`

Values with business meaning, one file per concern: `api.ts` (`ApiEndpoints` +
`DEFAULT_DOWNLOAD_HOST_ALLOWLIST` — no hard-coded URLs at call sites), `defaults.ts`
(timing, concurrency), `limits.ts` (archive/zip-bomb caps), `files.ts` (path segments used by
`core/paths.ts`), `launch.ts`, `platform.ts`, `runtime.ts`, `maven.ts`.

## `src/cli/`

Interactive `mckit` CLI built on Clack prompts. **Must not import from domain modules** — calls
only `kit.*` and types. Two sub-trees: `src/cli/ui/` (the prompt port and its
implementations) and `src/cli/scenarios/` + `src/cli/scenarios/pickers/` (one flow per menu
entry). Paths below are relative to `src/cli/`.

- `index.ts` — bin entry; calls `bin()` from `main.ts`.
- `main.ts` — `runCli` dispatcher and `MAIN_MENU` list.
- `ui.ts` — assembly point: builds the `Ui` port (`select`, `text`, `confirm`, `spinner`,
  `note`, `log`, `searchableSelect`) from the pieces under `ui/`.
- `ui/*` — `types.ts` (the `Ui` port), `clack-bootstrap.ts` (loads the optional
  `@clack/prompts` dependency), `select.ts` / `text.ts` / `spinner.ts` (the real
  implementations), `stub.ts` (`createStubUi`, the scripted implementation tests drive).
- `progress.ts` — `ProgressRenderer` consumes `ProgressEvent`s and prints a bar. Also exports
  `formatBytes` / `formatDuration` (the only copies in the codebase).
- `error-format.ts` — `MinecraftKitError` → user-facing text. Domain code never formats
  user strings.
- `open-browser.ts` — the one sanctioned `child_process.spawn` outside `Spawner`: opens a
  validated `http(s)` URL with platform-native commands, never through a shell.
- `scenarios/index.ts` — thin re-export hub over `scenarios/`.
- `scenarios/types.ts` — `ScenarioContext`, `ScenarioOutcome`, `InstallSelection`,
  `CHANNEL_OPTIONS`, `InstallWizardSteps` + `InstallRunResults` (as-const step/result names
  shared between `install.ts` and `install-helpers.ts`).
- `scenarios/pickers/` — interactive pickers, one file per domain:
  - `index.ts` — re-export hub.
  - `version.ts` — `pickChannel`, `pickMinecraftVersion`, `pickMinecraftVersionFromEntry`.
  - `loader.ts` — `pickInstallType`, `pickFabricLoader`, `pickForgeBuild` (plus
    `FabricLoaderOutcome`, `ForgeBuildOutcome`).
  - `runtime.ts` — `pickRuntime`, `pickRuntimeComponent`, `pickRuntimeInstallRoot`.
  - `target.ts` — `pickDirectory`, `confirmInstall`, `pickInstalledTarget`.
- `scenarios/install-helpers.ts` — install plan/run plumbing, summary formatting,
  `defaultIdFor`, `previousFromDirectory`, `runInstallFromSelection` (returns typed
  `InstallRunResult`).
- `scenarios/install.ts` — `scenarioInstallMinecraft` and `scenarioInstallRuntime`. Both are
  switch-based state machines (`advanceInstallWizard` / `advanceRuntimeWizard`) driven by the
  `InstallWizardSteps` / `RuntimeWizardSteps` constants — no inline step-name literals.
- `scenarios/verify-repair.ts` — `scenarioVerify` and `scenarioRepair`.
- `scenarios/launch.ts` — `scenarioLaunch`.
- `scenarios/login.ts` — `pickInitialAuth` (startup sign-in) and `scenarioLogin` (session
  view / refresh / switch / sign out).
- `scenarios/inspect.ts` — `scenarioInspect`.

## `src/core/`

Cross-cutting utilities. Bottom of the dependency graph.

- `abort.ts` — `assertNotAborted(signal, message)` and `checkpoint({ signal, pauseController },
  message)`. The "check signal → await pause → check signal again" dance lives here once;
  install runner and `downloadFile`'s retry loop call into it.
- `archive.ts` — zip/jar reading with zip-bomb guards (entry count, file size, total size,
  compression ratio). `resolveContainedDestination(root, relativePath)` is the single
  containment primitive every archive/manifest-driven write resolves through.
  `readJarMainClass` parses `META-INF/MANIFEST.MF` with line-fold handling.
- `assert-never.ts` — `assertNever(value)` exhaustiveness sentinel for `switch` on
  discriminated unions.
- `collections.ts` — `dedupe` / `dedupeBy` helpers (used by Forge install planner).
- `errors.ts` — `MinecraftKitError` class, `isMinecraftKitError` / `isErrorCode` guards, and
  the re-exported `MinecraftKitErrorCodes` registry.
- `fs.ts` — `ensureDir`, `fileExists`, `dirExists`, `fileSize`, `atomicWrite` (temp + rename),
  `readText`, `readBytes`, `listChildDirectories`, `chmodExecutable`, `assertWithinRoot`
  (zip-slip defence).
- `guards.ts` — lightweight runtime predicates for network JSON. Primitives:
  `isPlainObject`, `isNonEmptyString`, `isNonNegativeInteger`, `isArrayOf`, `isSha1Hex`,
  `isArtifactDownload`. Mojang/Fabric manifest shapes: `isMinecraftVersionManifestShape`,
  `isVersionManifestRootShape`, `isAssetIndexShape`, `isMojangJavaRuntimesShape`,
  `isJavaRuntimeManifestShape`, `isFabricProfileShape`. Forge-specific guards live next to
  their consumer in `src/install/forge-installer-archive.ts` (`isForgeInstallProfileShape`,
  `isLegacyForgeInstallProfileShape`, `isForgeInstallerProfileShape`,
  `isForgeVersionJsonShape`). Pairs with `parseJsonAs`.
- `hash.ts` — `sha1OfFile` (streaming; wraps the read stream in `try/finally` and destroys
  it on error).
- `json.ts` — `parseJsonStrict<T>` (wraps parse failures into `MinecraftKitError`),
  `parseJsonAs<T>` (parse + guard), `parseJsonOrUndefined<T>` (silent peek).
- `logger.ts` — `silentLogger` (default), `consoleLogger`, and `scopedLogger(base, scope,
  baseFields?)` which prefixes every line with `[scope]` and merges optional default
  fields. Returns `silentLogger` short-circuit when the base is silent.
- `manifest-merge.ts` — merge a child Minecraft manifest with its `inheritsFrom` parent.
- `maven.ts` — `parseMavenCoordinate`, `mavenRelativePath`, and `mavenRelativePathFor`.
- `pause-controller.ts` — caller-driven pause/resume primitive consumed by `downloadFile`
  and the install runner.
- `paths.ts` — `targetPaths.*` — every per-target directory layout helper, plus
  `javaExecutableUnder(runtimeRoot, os)`: the single definition of the per-OS Java executable
  layout, which `targetPaths.runtimeJavaExecutable` and target discovery both go through. Hard-coded
  path segments live in `src/constants/files.ts`.
- `retry.ts` — `withRetry` (full-jitter exponential backoff) and `isHttpRetryable`.
- `rules.ts` — `evaluateRules` (Mojang OS/feature rule semantics) and `resolveArchPlaceholder`.
- `system.ts` — `detectSystem` (host OS / arch detection).
- `deferred.ts` — `deferred<T>()` (promise plus its resolve/reject handles).
- `optional.ts` — `withOptionalSignal` / `withOptionalOnEvent` / `withOptionalPauseController`
  / `withOptionalHostAllowList`. `exactOptionalPropertyTypes` makes `{ signal: undefined }` a
  type error, so option objects are spread through these instead of assigned conditionally.
- `version-id.ts` — `asMinecraftVersionId`, the brand constructor callers use to pass a raw
  version string into the versions / targets APIs.
- `uuid.ts` — `offlineUuidFor` (Mojang's `MD5("OfflinePlayer:" + name)`) and
  `stripUuidDashes`.
- `xml.ts` — `parseMavenMetadataVersions` (regex-based; Maven metadata is rigid enough).

## `src/http/`

- `client.ts` — `FetchHttpClient` (the default `HttpClient`). Uses a `Symbol` sentinel to tell
  timer-driven aborts apart from parent-signal aborts.
- `download.ts` — `downloadFile`: streaming sha1, atomic temp + rename, skip-on-correct,
  retry-with-backoff, `download:*` events. Validates the URL scheme (`http(s)` only) and the
  `hostAllowList` before touching the network, then re-validates the final `response.url`
  after redirects — this closes the manifest-injection attack class. The allow-list is
  default-on (see `docs-site/guides/security.md`). Accepts `url: string | readonly string[]`: mirror URLs
  are tried sequentially, each with a full retry budget, and the next URL is only
  consulted when the previous one's retries are exhausted; an empty array throws
  `INVALID_INPUT`. Exports `pickPrimaryDownloadUrl` so the verify layer can record the primary
  URL of a multi-URL action.
- `cache.ts` — `createMemoryCache` (LRU-backed `MetadataCache`).
- `persistent-cache.ts` — `createPersistentMetadataCache`: a disk-backed `MetadataCache` so a
  consumer can resolve versions offline after one online run.
- `metadata.ts` — `fetchJson` and `fetchText` (cached GET helpers).
- `manifests.ts` — `fetchAssetIndex`, `fetchRuntimeManifest`, and the `uniqueAssetObjects`
  generator that both the asset planner and `verifyMinecraft` dedupe through.
- `postForm.ts` — `postFormUrlEncoded`, used only by the OAuth `/token` grants.
- `status.ts` — `isHttpOk`.

## `src/install/`

- `planner.ts` — `planInstall` aggregates vanilla / library / asset / logging / runtime /
  loader actions into a flat `InstallPlan`. Categories come from `DownloadCategories` — no
  inline category strings.
- `runner.ts` — `runInstall` executes a plan via an `InstallRunnerContext` that bundles
  counters + checkpoint + phase tracker + p-limit pool. Five focused stage functions handle
  downloads / writes / natives / runtime materialisation / Forge processors; the runtime
  stage uses the optional `target.loader?` access so runtime-only plans (`RuntimeOnlyInstallTarget`)
  do not need a phoney loader.
- `processor.ts` — `runProcessor`: resolves a Forge processor JAR's `Main-Class`, spawns it
  via the injected `Spawner`, tails stderr up to `MAX_PROCESSOR_STDERR_LINES`, and verifies
  every declared output sha1.
- `assets.ts` — `planAssetDownloads` (fetches the asset index, dedupes by hash).
- `libraries.ts` — `planLibraryDownloads` (walks library entries, evaluates OS rules,
  emits download + native-extraction actions).
- `fabric-install.ts` — `planFabricInstall` (profile JSON write + libraries).
- `forge-install.ts` — `planForgeInstall` (download installer, parse modern or legacy
  `install_profile.json`, extract embedded Maven/universal artifacts, resolve tokens for
  modern profiles, build processor actions when processors exist) and
  `listExtractedInstallerArtifacts` (the embedded artifacts the last flush wrote, read from the
  sentinel so `verify.forge` can existence-check them).
- `runtime.ts` — `planRuntimeDownloads` (file-type entries of a runtime manifest).
- `runtime-extras.ts` — `materializeRuntimeExtras` (directory placeholders + symlinks; falls
  back to `copyFile` when symlinks are forbidden; throws if both fail).
- `runtime-install.ts` — `planRuntimeInstall` (target-bound) and
  `planStandaloneRuntimeInstall` (no Minecraft target needed).
- `forge-installer-archive.ts` — reads `install_profile.json` / the version JSON out of the
  installer JAR, with the Forge-specific shape guards.
- `forge-processor-plan.ts` — `resolveProfileData` + `buildProcessorActions` (token
  resolution for modern processor profiles). `entryExtraction` decides whether an embedded
  `data[*]` entry is extracted, reused, or only resolved to a path (`skip`, for `verify`).
- `forge-processor-outputs.ts` — `listForgeProcessorOutputs`: the files the processors are
  expected to generate, with the SHA-1s `install_profile.json` declares, read off the installer
  JAR already on disk. Offline and side-effect-free, which is what lets `verify.forge` check
  generated artifacts (`<mc>-srg.jar` and friends) that no `DownloadAction` covers.
- `forge-data-value.ts` — `decodeForgeDataValue`: Forge's `[coord]` / `'literal'` / path
  encoding for `install_profile.json` data entries.
- `progress-tracker.ts` — `createInstallProgressTracker`: folds fine-grained
  `InstallPhases` + download events into the five coarse `ProgressStages` as throttled UI
  snapshots. This is the kit's only progress-throttling primitive.

## `src/launch/`

- `compose.ts` — `composeLaunch`. Thin orchestrator: validates auth, resolves the version
  chain, builds the classpath, defers placeholder computation and argument composition.
- `placeholder-values.ts` — `buildPlaceholderValues` (maps auth + paths → `${...}` table).
- `args-composition.ts` — `composeArgs` (JVM and game arg pipeline: memory + base + macOS +
  manifest-jvm + logging + extra; manifest-game + extra + resolution/fullscreen).
- `placeholders.ts` — `substituteArg` / `substituteArgs` (the actual `${}` replacement).
- `classpath.ts` — `buildClasspath` (library entries → absolute path list + version jar).
- `version-resolution.ts` — `resolveLaunchVersion` (loads + merges the on-disk version JSON),
  `pickClientJarVersionId` (which jar lands on the classpath for loader installs).
- `arguments.ts` — `flattenArguments` / `splitLegacyArguments` / `pickArguments` (rule-aware
  manifest argument flattening).
- `runner.ts` — `runLaunch` spawns the child and returns a `LaunchSession`. A single
  `doAbort()` guards both the signal listener and the manual abort method.
- `spawner.ts` — `ChildProcessSpawner` (the default). Bounds line buffers at
  `SPAWNER_MAX_LINE_BYTES` to keep launcher memory flat under pathological output.
- `jvm-compat.ts` — `filterArgsForJava`: drops manifest JVM args the resolved Java major
  does not accept.
- `preflight.ts` — `launchPreflight`, the network-free subset of `verify.targetReady`.

## `src/verify/`

- `helpers.ts` — `runVerification` boilerplate, `verifyHashedFile`, the pooled
  `verifyHashedFiles` (bounded by `VERIFY_CONCURRENCY`, records in input order as results land, so
  events stream while the pool works and `issues` ordering stays deterministic),
  `recordLibraryDownloads`, `verifyExistence`,
  `findForgeVersionJsonPath`.
- `aspects.ts` — `VERIFIERS` (kind → verifier) and `aspectsForTarget`. Owned by `verify/` so a
  readiness check does not have to import `src/repair/`; `repair/aspects.ts` composes its
  `ASPECTS` map over `VERIFIERS`. Do not move this back — the reverse direction is an import
  cycle (`tests/verify/layering.test.ts` guards it).
- `minecraft.ts`, `fabric.ts`, `forge.ts`, `runtime.ts` — per-aspect verifiers.
- `target-readiness.ts` — `verifyTargetReadiness`, the aggregate launch gate over Minecraft +
  runtime + the active loader.
- `index.ts` — the verify barrel.

## `src/repair/`

- `helpers.ts` — `IssueIndex`, `selectRepairActions`, `buildRepairPlan`,
  `planAspectRepair` (the shared template used by every aspect planner). `planAspectRepair`
  reuses `input.installPlan` when the caller passes one — `repairAll` builds the install plan
  once and shares it across aspects, because they all filter the same plan and planning a Forge
  target is expensive.
- `aspects.ts` — `ASPECTS` (kind → `{ verify, plan }`), composed over `verify/aspects`.
- `all.ts` — `repairAll`: verify every applicable aspect, build one install plan, repair each
  broken aspect from it, and return that plan on the report so the caller can reuse it.
- `index.ts` — the repair barrel (`planXxxRepair`, `runRepair`, `repairAll`,
  `verifyAndRepair`, `planRepairFromError`).
- `minecraft.ts`, `fabric.ts`, `forge.ts`, `runtime.ts` — per-aspect repair planners; each is
  a thin `planAspectRepair` call plus the aspect's action filter.
- `from-error.ts` — `planRepairFromError` and the pure `deriveRepairActionsFromError`
  mapper. Derives a minimal `RepairPlan` from a typed `MinecraftKitError` thrown by a
  previous install. Wired onto the kit facade as `kit.repair.fromError({ error, target })`.
  Supported codes live in `RepairFromErrorSupportedCodes`; unsupported codes throw
  `INVALID_INPUT` so the caller falls back to the regular `verify → plan → run` path.
- `verify-and-repair.ts` — `verifyAndRepair(deps, { aspect, target, mode? })`. Wraps the
  `verify → plan → run` cycle for a single aspect into one call. `RepairModes.FIX`
  (default) repairs on detection; `RepairModes.REPORT` runs verify only and never touches
  disk. Wired onto the facade as `kit.repair.verifyAndRepair(input)`.
- `runner.ts` — `runRepair` is a thin wrapper that calls `runInstall` on the repair plan. It
  forwards the full install control set (`signal`, `pauseController`, `actionCategories`,
  `hostAllowList`) and reports `actionsSkipped` alongside `actionsCompleted`.

## `src/auth/`

Microsoft OAuth → Xbox Live → Minecraft sign-in pipeline. **Stateless** — the kit returns
tokens to the caller; persistence is the launcher's job. The flow is OAuth 2.0
Authorization-Code + PKCE with a loopback redirect — the kit binds a localhost server,
the caller opens the system browser, and the browser redirects back with the one-time
code.

- `index.ts` — `MojangAuthApi` (facade on `kit.auth`) with `authorizationCode.run()` and
  `refresh()`. `toOnlineAuth(session)` projects a session into the `OnlineAuth` shape
  consumed by `kit.launch.compose`.
- `oauth.ts` — `buildAuthorizeUrl`, `generateOAuthState`, `generatePkcePair`. PKCE helpers
  + the URL builder for `login.microsoftonline.com/consumers/oauth2/v2.0/authorize`.
- `loopback.ts` — `startLoopbackServer`. Single-shot HTTP listener on `127.0.0.1:<random>`
  that captures the `code`/`state`/`error` query string from Microsoft's redirect, then
  closes itself.
- `microsoftToken.ts` — `exchangeAuthorizationCode`, `refreshMicrosoftToken`. The two
  `/token` grants the kit ships.
- `xbox.ts` — `authenticateXbl`, `authenticateXsts`. XSTS `XErr` codes (banned, no profile,
  country restriction, child account) translate into human-readable strings.
- `minecraft.ts` — `loginWithXbox`, `fetchMinecraftProfile`, `extractXuid` (decodes the
  `xuid` claim from the JWT-shaped access token). 403 + `"invalid app registration"` is
  recognised and points the user at `https://aka.ms/mce-reviewappid`.
- `client-id.ts` — the brand constructors `asAzureClientId` / `asMicrosoftRefreshToken` and
  `resolveClientId`, which falls back to `CLIENT_ID_ENV_VAR`
  (`MINECRAFT_KIT_MSA_CLIENT_ID`). The kit ships no default client id by design.
- `options.ts` — `AuthorizationCodeRunOptions` / `RefreshOptions`.
- `pipeline.ts` — `exchangeMicrosoftToMojang`: the Microsoft-token → XBL → XSTS →
  `login_with_xbox` → profile chain, shared by the sign-in and refresh entry points.
- `profile-read.ts` — `readProfile` (`minecraft/profile` GET).
- `profile-mutations.ts` — `setSkinFromUrl`, `uploadSkin`, `resetSkin`.
- `skin-variant-detect.ts` — `detectSkinVariant`: infers `classic` / `slim` from PNG pixels
  so `SkinVariantInputs.AUTO` can resolve without asking the user.
- `debug.ts` — `DEBUG_ENV_VAR` (`MINECRAFT_KIT_AUTH_DEBUG`) and `buildAuthLogger(base)`
  that routes auth trace through a `Logger` interface with an env-toggled `consoleLogger`
  fallback. Auth-flow helpers (`startLoopbackServer`, `loginWithXbox`, the
  `MojangAuthApi` pipeline) accept a `logger?` option and emit `debug` lines through it.

## `src/versions/`

- `context.ts` — `ResolverContext` (DI bundle: http, cache, logger).
- `minecraft.ts` — `MinecraftVersionsApi` (list / latest / get / resolve). Vanilla-loader
  wrapping is inline in `TargetsApi.resolve`; there is no dedicated method.
- `fabric.ts` — `FabricVersionsApi` (list / resolve).
- `forge.ts` — `ForgeVersionsApi` (list / resolve via Maven metadata + promotions).
- `runtime.ts` — `RuntimeVersionsApi` (list / resolve via Mojang runtime index).

## `src/targets/`

- `index.ts` — `TargetsApi` with `create`, `resolve`, and `list` (filesystem scan that
  discovers `versions/*` and infers loaders).
