# Open findings — 2026-08-07 adversarial review

Verified against the code. The release-ordering fix from the same review already landed.

## The published 0.9.0 ships dangling sourcemap references

`sourcemap: false` landed **after** the release tag: the order is `4823f8d` →
`6ee4c70 chore(release): v0.9.0` → `14d242e … stop shipping sourcemaps`. The published
tarball's `dist/index.mjs`, `dist/index.cjs` and `dist/cli/index.mjs` each carry two
`//# sourceMappingURL=` comments with no `.map` files in the package. HEAD is clean —
it just needs a 0.9.1 to reach consumers. Until then a consumer's DevTools logs
`Failed to load source map` and bundlers warn about missing sources.

Latent: `tsconfig.json:19-20` still sets `declarationMap` + `sourceMap`, inert only
because tsup's dts path ignores them. Switching to tsc-emitted declarations
reintroduces the same problem in the `.d.ts` a consumer's tsserver reads.

## The export-name gate can be defeated without touching a name

`scripts/check-exported-names.mjs:46-47` collects `element.name.text` and never reads
`isTypeOnly`. Turning `export {` into `export type {` at `src/index.ts:44` keeps the
name set identical, so the gate reports `removed: []`, the kit's own `tsc --noEmit`
stays clean, `tests/api-surface.test.ts` strips a leading `type ` in its own regex, and
`attw` is green — while esbuild erases the binding from the bundle. A consumer calling
it gets `TypeError: … is not a function`. 20 of the launcher's 29 value imports are
flippable this way, and a `refactor:` commit derives a patch bump, so `^0.9.0` takes it
on `npm update`.

The gate is also blind to `package.json#exports`: HEAD already removed the public
`./cli` subpath, and the gate reports "no exported name was removed". Reading the built
output (or at least `isTypeOnly` plus the export map) is the fix.

## Progress: bytes exceed the total after a retry

`src/http/download.ts:168-172` emits `DOWNLOAD_STARTED` on every attempt (up to 4 per
URL per mirror), and `src/install/progress-tracker.ts:305-311` replaces the in-flight
entry with `bytes: 0` without subtracting the failed attempt's accumulated bytes from
`stageInFlight`/`totalInFlight`. Only the final attempt's bytes are ever reclaimed
(`:343-344`). Measured against the published bundle: a stall at 600/1000 then a
successful retry reports `bytesDownloaded: 1600, totalBytes: 1000`.

## `finish()` does not emit the promised final 100% snapshot

`progress-tracker.ts:122` documents one; `:374-387` forces `currentStage = FINALIZE`,
whose total is structurally always 0 because no `DownloadCategory` maps to it
(`:125-135`). The emitted snapshot is `{stagePercent: 0, bytesDownloaded: 0,
totalBytes: 0}` — the last event of every install and repair. The test that should
catch it (`tests/install/progress-tracker.test.ts:152-164`) asserts
`bytesDownloaded === totalBytes`, which is vacuously `0 === 0`.

## Forge processor verification fails open

`src/install/forge-processor-outputs.ts:55` (`if (!fileExists(installerPath)) return []`)
and `:58` (`catch { return [] }`) mean a missing, truncated or unparseable installer JAR
makes processor outputs go unverified rather than reported. Errors that used to carry a
classified code — `FORGE_INSTALLER_INVALID` for an unknown `{TOKEN}`
(`src/install/forge-processor-plan.ts:241`), `ARCHIVE_INVALID`, `FILESYSTEM_READ_ERROR`
— now vanish into an empty list. See the consumer-side consequences in
`loontail-launcher/docs/audit-backlog.md`.

`:97` also drops any output whose declared value is not 40 hex chars, losing even its
existence check. The filter itself fixes a real waste (the previous code compared a real
digest against `""` and re-ran that processor on every repair forever) — existence-
checking hashless outputs, as `src/verify/forge.ts:139-166` already does for `url: ""`
artifacts, preserves both behaviours.

`src/repair/forge.ts:52-55` builds `forgeJsonPath` from `loader.fullVersion`
(`1.20.1-47.2.0`) while the plan's `WRITE_VERSION_JSON` uses `version.id`
(`1.20.1-forge-47.2.0`), so the `action.path === forgeJsonPath` test at `:63` cannot be
true in production. Untestable in-repo because `tests/helpers/forge-fixture.ts:12` sets
`fullVersion === version.id`.

## Documented codes that are never thrown

`METADATA_PARSE_ERROR`, `NOT_IMPLEMENTED` and `UNSUPPORTED_VERSION` each appear exactly
once in `src/` — their own registry line. `METADATA_PARSE_ERROR` is the notable one:
`docs/error-codes.md:59` gives it a specific trigger and the launcher maps it, but
`parseJsonStrict`/`parseJsonAs` take the code from the caller and no caller passes it.

## Minor

- Hashing an output is not abortable mid-file (`src/core/hash.ts:11` passes no signal),
  so a stop during repair waits out the current 100–400 MB patched jar.
- tsup runs both array configs concurrently and config #1's `clean: true` is
  unsynchronised against config #2 writing `dist/cli/index.mjs`. npm silently omits
  missing `files` entries, so a publish would succeed with `mckit` pointing at nothing.
