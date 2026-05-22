# Modules (internal)

One-paragraph orientation per source module. For deep dives read the source — these notes
exist so you don't have to grep for "where does X live".

## `src/cli/`

Interactive `mckit` CLI built on Clack prompts. **Must not import from domain modules** — calls
only `kit.*` and types.

- `index.ts` — bin entry; calls `bin()` from `main.ts`.
- `main.ts` — `runCli` dispatcher and `MAIN_MENU` list.
- `ui.ts` — `Ui` abstraction with `select`, `text`, `confirm`, `spinner`, `note`, `log`, plus
  `searchableSelect`. Has a `createStubUi` factory used by tests.
- `progress.ts` — `ProgressRenderer` consumes `ProgressEvent`s and prints a bar. Also exports
  `formatBytes` / `formatDuration` (the only copies in the codebase).
- `error-format.ts` — `MinecraftKitError` → user-facing text. Domain code never formats
  user strings.
- `scenarios.ts` — thin re-export hub over `scenarios/`.
- `scenarios/types.ts` — `ScenarioContext`, `ScenarioOutcome`, `InstallSelection`,
  `CHANNEL_OPTIONS`, `InstallWizardSteps` + `InstallRunResults` (as-const step/result names
  shared between `install.ts` and `install-helpers.ts`).
- `scenarios/pickers/` — interactive pickers, one file per domain:
  - `index.ts` — barrel.
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
  compression ratio). `readJarMainClass` parses `META-INF/MANIFEST.MF` with line-fold handling.
- `assert-never.ts` — `assertNever(value)` exhaustiveness sentinel for `switch` on
  discriminated unions.
- `collections.ts` — `dedupe` / `dedupeBy` helpers (used by Forge install planner).
- `errors.ts` — `MinecraftKitError` class, `isMinecraftKitError` / `isErrorCode` guards, and
  the re-exported `MinecraftKitErrorCodes` registry.
- `fs.ts` — `ensureDir`, `fileExists`, `dirExists`, `fileSize`, `atomicWrite` (temp + rename),
  `readText`, `readBytes`, `listChildDirectories`, `chmodExecutable`, `assertWithinRoot`
  (zip-slip defence).
- `guards.ts` — lightweight runtime predicates for network JSON (`isPlainObject`,
  `isNonEmptyString`, `isNonNegativeInteger`, `isArrayOf`, `isSha1Hex`, `isArtifactDownload`,
  `isMinecraftVersionManifestShape`). Pairs with `parseJsonAs`.
- `hash.ts` — `sha1OfFile` (streaming; wraps the read stream in `try/finally` and destroys
  it on error).
- `json.ts` — `parseJsonStrict<T>` (wraps parse failures into `MinecraftKitError`),
  `parseJsonAs<T>` (parse + guard), `parseJsonOrUndefined<T>` (silent peek).
- `logger.ts` — `silentLogger` (default), `consoleLogger`, and `scopedLogger(base, scope,
  baseFields?)` which prefixes every line with `[scope]` and merges optional default
  fields. Returns `silentLogger` short-circuit when the base is silent.
- `lzma.ts` — `decodeLzma` for Mojang runtime sidecars (LZMA1 "alone" format).
- `manifest-merge.ts` — merge a child Minecraft manifest with its `inheritsFrom` parent.
- `maven.ts` — `parseMavenCoordinate`, `mavenRelativePath`, and `mavenRelativePathFor`.
- `pause-controller.ts` — caller-driven pause/resume primitive consumed by `downloadFile`
  and the install runner.
- `paths.ts` — `targetPaths.*` — every per-target directory layout helper. Hard-coded path
  segments live in `src/constants/files.ts`.
- `retry.ts` — `withRetry` (full-jitter exponential backoff) and `isHttpRetryable`.
- `rules.ts` — `evaluateRules` (Mojang OS/feature rule semantics) and `resolveArchPlaceholder`.
- `system.ts` — `detectSystem` (host OS / arch detection).
- `throttle.ts` — wrap a `ProgressListener` to rate-limit `download:progress` events.
- `uuid.ts` — `offlineUuidFor` (Mojang's `MD5("OfflinePlayer:" + name)`) and
  `stripUuidDashes`.
- `xml.ts` — `parseMavenMetadataVersions` (regex-based; Maven metadata is rigid enough).

## `src/http/`

- `client.ts` — `FetchHttpClient` (the default `HttpClient`). Uses a `Symbol` sentinel to tell
  timer-driven aborts apart from parent-signal aborts.
- `download.ts` — `downloadFile`: streaming sha1, atomic temp + rename, skip-on-correct,
  retry-with-backoff, `download:*` events. Validates the URL scheme (`http(s)` only) and an
  optional caller-supplied `hostAllowList` before touching the network — closes the
  manifest-injection attack class.
- `cache.ts` — `createMemoryCache` (LRU-backed `MetadataCache`).
- `metadata.ts` — `fetchJson` and `fetchText` (cached GET helpers).

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
- `forge-install.ts` — `planForgeInstall` (download installer, extract `maven/` entries,
  parse `install_profile.json` + version.json, resolve tokens, build processor actions).
- `runtime.ts` — `planRuntimeDownloads` (file-type entries of a runtime manifest).
- `runtime-extras.ts` — `materializeRuntimeExtras` (directory placeholders + symlinks; falls
  back to `copyFile` when symlinks are forbidden; throws if both fail).
- `runtime-install.ts` — `planRuntimeInstall` (target-bound) and
  `planStandaloneRuntimeInstall` (no Minecraft target needed).

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

## `src/verify/`

- `helpers.ts` — `runVerification` boilerplate, `verifyHashedFile`, `verifyExistence`,
  `findForgeVersionJsonPath`.
- `minecraft.ts`, `fabric.ts`, `forge.ts`, `runtime.ts` — per-aspect verifiers.

## `src/repair/`

- `helpers.ts` — `IssueIndex`, `selectRepairActions`, `buildRepairPlan`,
  `planAspectRepair` (the shared template used by every aspect planner).
- `minecraft.ts`, `fabric.ts`, `forge.ts`, `runtime.ts` — per-aspect repair planners (each
  ~30 LOC after the M6 refactor).
- `runner.ts` — `runRepair` is a thin wrapper that calls `runInstall` on the repair plan.

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
- `debug.ts` — `DEBUG_ENV_VAR` (`MINECRAFT_KIT_AUTH_DEBUG`), legacy `authDebug` stderr
  writer, and `buildAuthLogger(base)` that routes auth trace through a `Logger` interface
  with an env-toggled `consoleLogger` fallback.

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
