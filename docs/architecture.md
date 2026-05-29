# Architecture (internal)

## Layering

```
src/cli/             ← interactive CLI; imports from public API only
src/kit.ts           ← public facade
src/index.ts         ← public re-exports
─────────────────────────────────────────────────────
src/install/         ← plan + execute install
src/verify/          ← per-aspect file checks
src/repair/          ← verify result → repair plan
src/launch/          ← argument composition + child process
src/auth/            ← Microsoft OAuth → Xbox → Minecraft sign-in
src/versions/        ← Mojang / Fabric / Forge / runtime resolvers
src/targets/         ← target resolution & discovery
─────────────────────────────────────────────────────
src/http/            ← HTTP client, cache, streaming download
src/core/            ← cross-cutting utils (fs, hash, archive, paths, rules,
                       abort, json, guards, logger, assert-never, …)
src/types/           ← public type declarations
src/constants/       ← endpoint URLs, defaults, limits, file segments
```

Allowed dependency direction: any layer may depend on layers below it. CLI may not be imported
by anything except itself and the bin entry point. Domain modules (install / verify / repair /
launch / versions / targets) may not import from `src/cli/`.

## Public surface

The public surface is exactly what `src/index.ts` re-exports. Everything else is internal and
may be renamed or removed without a release note. The single entry class is
`MinecraftKit`; the standalone helpers (`verifyMinecraft`, `planMinecraftRepair`, etc.)
are exposed for consumers that want to avoid the facade.

## Key design choices

- **Stateless.** The library only writes files Minecraft itself expects (`versions/`,
  `libraries/`, `assets/`, `runtime/`). There is no launcher-private state, no persisted
  session, no profile registry. Consumers own all metadata about their installations,
  including authentication tokens — `kit.auth.authorizationCode.run()` returns a
  `MojangSession`; storing the refresh token is the launcher's job.
- **Plan + execute split.** Every long-running operation (install, update, repair) produces an
  `InstallPlan` before it starts touching disk. Tests assert on plans; runners are tested
  separately with `FakeHttpClient` / `FakeSpawner`.
- **Dependency injection.** `HttpClient`, `MetadataCache`, `Spawner`, `Logger`, and
  `RuntimeSystem` are all injectable on the `MinecraftKit` constructor. The defaults are
  `FetchHttpClient` (node `fetch`), in-memory LRU cache, `ChildProcessSpawner`, silent logger,
  and `detectSystem()`.
- **Discriminated unions, never inline literals.** Install actions, launch events, install
  phases, loader kinds, verification statuses, download categories, error codes — every
  enum-like string lives as an `as const` map (`InstallActionKinds`, `DownloadCategories`,
  `EventTypes`, `Loaders`, `VerifyFileStatuses`, `InstallPhases`, `MinecraftKitErrorCodes`,
  `WizardOutcomes`, `InstallWizardSteps`, …). Business code references the constant; the
  derived union type forces TypeScript to flag typos.
- **No silent catches.** Empty `catch` blocks are allowed only with a one-line comment naming
  the explicit reason (e.g. "ENOENT during cleanup of temp file before throwing").
- **Boundary validation.** JSON pulled over the network passes through `parseJsonAs(text,
  guard)` and one of the predicates in `src/core/guards.ts`. The kit ships without Zod by
  design — shape checks are short hand-written predicates colocated with the call site.
- **Defence in depth on downloads.** `downloadFile` rejects unparseable URLs and non-`http(s)`
  schemes before fetch. Consumers shipping in hostile environments can additionally pin to
  a `hostAllowList` (supports `*.minecraft.net`-style wildcards).
- **Single interrupt point.** Every long-running stage routes signal + pause through
  `checkpoint()` in `src/core/abort.ts`. The order is signal-check → await pause →
  signal-check-again; no caller hand-rolls it.

## Operation lifecycles

### Install
1. `planInstall` walks the target's vanilla manifest, asset index, runtime manifest, and loader
   metadata. It produces a flat `InstallAction[]`. **No disk writes happen during planning**
   except Forge installer artifacts: the installer JAR must be on disk to read
   `install_profile.json`, and legacy Forge profiles may extract their embedded universal JAR
   into `libraries/` while building the plan.
2. `runInstall` consumes the plan: parallel downloads (concurrency = `DOWNLOAD_CONCURRENCY`),
   then atomic writes, then native extractions, then runtime symlinks/dirs, then Forge
   processors. Each phase emits `install:phase-changed`.
3. Downloads that match expected size + sha1 on disk are skipped automatically — install,
   update, and repair share this path.

### Verify
Per-aspect verifiers (`verifyMinecraft`, `verifyFabric`, `verifyForge`, `verifyRuntime`) each
walk the files they own. They emit one `verify:file-checked` event per file and return a
`VerificationResult` with the issue list. The shared `runVerification` helper in
`src/verify/helpers.ts` owns the timing/issue-array/emit boilerplate.

### Repair
A `VerificationResult` (or array thereof) feeds `planXxxRepair`. The shared `planAspectRepair`
helper in `src/repair/helpers.ts` builds an `InstallPlan` filtered to the aspect's actions,
keeping only those whose target file was reported as broken. The Forge planner adds a
defensive post-step: if the version JSON itself was missing, every forge-library plus all
processors are included (skip-on-correct keeps it cheap).

There is also a verify-less resume path: `kit.repair.fromError({ error, target })` —
implemented in `src/repair/from-error.ts` — inspects a typed `MinecraftKitError` from a
previous run and returns a `RepairPlan` containing only the actions named in
`error.context` (one download for an integrity mismatch, the whole Forge processor stage
for `FORGE_PROCESSOR_FAILED`, etc.). Supported codes are listed in
`RepairFromErrorSupportedCodes`; anything else throws `INVALID_INPUT` so the caller falls
back to the regular `verify → plan → run` flow.

For the common "find and fix this aspect now" case there is also
`kit.repair.runVerifyAndRepair({ aspect, target, mode? })` (implemented in
`src/repair/run-with-diagnose.ts`). It runs the matching `verify.<aspect>.run`, and in the
default `RepairModes.FIX` mode follows up with `repair.<aspect>.plan` + `runRepair` for
any issues found. In `RepairModes.REPORT` mode it returns the verification only and never
writes to disk. The four per-aspect surfaces and `repair.all` stay — `runVerifyAndRepair`
is a thin orchestrator on top of them, not a replacement.

### Launch
1. `composeLaunch` resolves the on-disk version JSON chain (walking `inheritsFrom`), builds
   the classpath, computes every `${placeholder}` value, and folds the JVM/game args together.
2. `runLaunch` spawns the child via the injected `Spawner` and returns a `LaunchSession` with
   `pid`, `exited` promise, and an `abort()` method. Both the signal listener and `abort()`
   route through a single guarded `doAbort()` so events never double-emit.

### Authentication
1. `kit.auth.authorizationCode.run({ clientId, onOpenBrowser })` runs the OAuth 2.0
   Authorization-Code + PKCE flow against the `consumers` tenant. The kit binds a loopback
   HTTP listener on `127.0.0.1:<random>`, hands the caller the authorize URL via
   `onOpenBrowser`, and waits for Microsoft to redirect the browser back with the one-time
   code.
2. The code is exchanged at `/token` (with the matching PKCE `code_verifier`) for a
   Microsoft access + refresh token.
3. The access token is exchanged for an Xbox Live RPS token, then an XSTS token bound to
   `rp://api.minecraftservices.com/`, then a Minecraft bearer token via `login_with_xbox`,
   then the player profile via `minecraft/profile`.
4. The composed `MojangSession` carries everything `kit.launch.compose` needs plus a
   refresh token. Persisting the refresh token is the caller's responsibility —
   `kit.auth.refresh(token)` re-runs steps 2–4 and may rotate the token.

## Where things live

- Error codes: `src/types/errors.ts` (`MinecraftKitErrorCodes` as-const + derived
  `MinecraftKitErrorCode` union). Add new codes here; do not invent ad-hoc string codes
  at throw sites.
- Event names: `src/types/events.ts` (`EventTypes` const + `ProgressEvent` union).
- Phase names: `src/types/install.ts` (`InstallPhases`).
- Download categories: `src/types/install.ts` (`DownloadCategories` + derived
  `DownloadCategory` union).
- Loader kinds: `src/types/loader.ts` (`Loaders`).
- Defaults/limits: `src/constants/defaults.ts` (timing, concurrency) and
  `src/constants/limits.ts` (archive caps).
- API endpoints: `src/constants/api.ts` (`ApiEndpoints`). No hard-coded URLs at call sites.
- Runtime shape predicates: `src/core/guards.ts`.
- Abort + pause guard: `src/core/abort.ts`.
- JSON parsing helpers: `src/core/json.ts`.
- Scoped logger: `src/core/logger.ts`.
