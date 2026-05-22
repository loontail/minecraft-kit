# AI agent context

If you are an AI agent picking up work on `@loontail/minecraft-kit`, read this first.

## Read these in order

1. [`code-guidelines.md`](./code-guidelines.md) — the rules every change must satisfy.
2. [`architecture.md`](./architecture.md) — layer map, lifecycles, where things live.
3. [`modules.md`](./modules.md) — one-paragraph orientation per source module.
4. [`error-codes.md`](./error-codes.md) — canonical error list.

Skip the user-facing tree (`docs-site/`) unless you are editing public documentation.

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
- **Discriminator field:** `kind` for actions/loaders, `type` for events. Don't mix.
- **`import type`** for type-only imports — Biome enforces this.
- **CLI ↔ domain isolation:** CLI imports only from the public facade and types. Domain
  modules don't import from CLI.

## Common gotchas

- **`InstallPhases.WRITING_FILES`** (string `"writing-files"`) replaced
  `WRITING_LOGGING_CONFIG` in M11. If you find any external reference to the old name, fix it.
- **`runtime-extras.ts`** symlink fallback throws on Windows when both `symlink` and
  `copyFile` fail. Earlier versions swallowed this, leading to cryptic launch failures —
  don't reintroduce the silent catch.
- **Forge installer is downloaded during planning.** `planForgeInstall` writes the installer
  JAR to disk because it needs to read `install_profile.json` before producing the rest of
  the plan. The same URL is then included as a `DOWNLOAD_FILE` action in the plan; `downloadFile`
  skips it because the on-disk hash already matches.
- **Asset deduplication.** Mojang asset indexes occasionally list the same hash under
  multiple virtual paths. `planAssetDownloads` and `verifyMinecraft` both deduplicate by
  hash. Touching one without the other will cause parallel writes to the same target during
  install / repair.
- **`pickClientJarVersionId`** walks `inheritsFrom` because Fabric and modern Forge use the
  *vanilla* client jar on the classpath; their own `versions/<id>/<id>.jar` is empty. Do
  not "fix" this by always picking the top of the chain.
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

## History

Use `git log` for the change record. There is no CHANGELOG — breaking changes are flagged
in PR titles with `feat!:` / `fix!:`, so they're findable with `git log --grep='!:'`.
