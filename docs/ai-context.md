# AI agent context

If you are an AI agent picking up work on `@loontail/minecraft-kit`, read this first.

Start with [`code-guidelines.md`](./code-guidelines.md); [`README.md`](./README.md) maps the
rest of this directory. Skip the user-facing tree (`docs-site/`) unless you are editing public
documentation.

## Conventions worth memorising

- **Public surface = `src/index.ts`.** Anything not re-exported there is internal. If you
  introduce a new helper, decide whether it should be public *before* writing it.
- **Errors:** always `MinecraftKitError` with a stable `code` from
  `src/types/errors.ts`. Wrap lower-level errors as `cause`. Never throw bare `Error`.
- **No magic strings.** Event names → `EventTypes`. Install phases → `InstallPhases`. Loader
  kinds → `Loaders`. File-status → `VerifyFileStatuses`. Endpoint URLs → `ApiEndpoints`.
- **No silent catches.** Empty catches are allowed only with a one-line comment naming the
  specific reason (e.g. "ENOENT during best-effort cleanup; we are about to throw the real
  error").
- **Discriminator field:** see `code-guidelines.md` §2 — `kind` on install actions, `type` on
  loaders and events.
- **`import type`** for type-only imports — Biome enforces this.
- **CLI ↔ domain isolation:** CLI imports only from the public facade and types. Domain
  modules don't import from CLI.

## Common gotchas

- **Two grain sizes of progress, do not conflate.** `InstallPhases` is the runner's own
  sequence and the `install:phase-changed` discriminator; `ProgressStages` is the coarse
  five-value UI grouping (`prepare` / `runtime` / `minecraft` / `loader` / `finalize`)
  consumed only by `createInstallProgressTracker`, which maps phases onto stages.
- **`runtime-extras.ts`** symlink fallback throws on Windows when both `symlink` and
  `copyFile` fail. Earlier versions swallowed this, leading to cryptic launch failures —
  don't reintroduce the silent catch.
- **Forge installer artifacts are materialised during planning.** `planForgeInstall` writes
  the installer JAR to disk because it needs to read `install_profile.json` before producing
  the rest of the plan. Legacy Forge profiles may also extract the embedded universal JAR
  referenced by `install.filePath` into `libraries/`. Both side effects are idempotent, and
  neither is expressed as a plan action:
  - The installer URL is **not** a `DOWNLOAD_FILE` action. Forge publishes no hash/size for
    its installers, so `downloadFile`'s skip-on-correct could never fire for one — an action
    would mean `install.run` re-fetching bytes planning already had. `ensureInstallerOnDisk`
    reuses an installer already on disk whenever `install_profile.json` still parses out of
    it, and deletes + re-downloads it when it does not. Corruption *past* that entry cannot
    wedge the install either: any `ARCHIVE_INVALID` / `FORGE_INSTALLER_INVALID` /
    `FILESYSTEM_READ_ERROR` raised while reading the archive re-fetches the JAR exactly once
    (`readInstallerArtifactsWithRetry`). Failures after the archive phase — an unknown
    processor token, a bad coordinate — are *not* retried; a fresh copy cannot fix them.
  - The `maven/` flush is guarded by a `libraries/.forge-<fullVersion>.extracted` sentinel
    holding the installer's `size:mtimeMs` on the first line and every `libraries/`-relative
    path it wrote after it. Both halves must hold for the flush to be skipped, because embedded
    artifacts carry `url: ""` — nothing downloads them, so re-extracting is the only way to
    restore one. `verify.forge` existence-checks the recorded paths for the same reason. The
    sentinel lives inside `libraries/` on purpose: deleting that directory by hand takes the
    sentinel with it, so the next plan re-extracts.
  - `DownloadCategories.FORGE_INSTALLER` is therefore an **event-only** category — it appears
    on `download:*` events raised during planning, never on a plan action.
- **Asset deduplication.** Mojang asset indexes occasionally list the same hash under
  multiple virtual paths. `planAssetDownloads` and `verifyMinecraft` both deduplicate by
  hash. Touching one without the other will cause parallel writes to the same target during
  install / repair.
- **`pickClientJarVersionId`** walks `inheritsFrom` because Fabric and processor-based Forge
  use the *vanilla* client jar on the classpath; their own `versions/<id>/<id>.jar` is empty.
  Legacy Forge can provide a differently-cased Forge version id, so Forge version discovery is
  case-insensitive. Do not "fix" this by always picking the top of the chain.

## Tests live in `tests/`, mirror `src/`

`tests/helpers/`:

- `fake-http.ts` — scripted HTTP client; records every request for assertions.
- `fake-kit.ts` — full kit stub with configurable return values for CLI / scenario tests.
- `fake-spawner.ts` — child-process stub with configurable exit codes + stdout/stderr.
- `hash.ts` — `sha1OfBytes` for tests that need to compute expected hashes of inline bodies.

Coverage thresholds in `vitest.config.ts` are floors, not goals. Aim for ≥ 80 % on any module
you change.

## When you write user-facing docs

User-facing docs live in `docs-site/`. Rules are in `code-guidelines.md` §8.
