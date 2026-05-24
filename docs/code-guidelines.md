# Code guidelines — `@loontail/minecraft-kit`

These rules govern every change inside `minecraft-kit`. They exist so the package stays small, predictable, and safe to refactor.

This document is internal. It is not published to end users.

---

## 1. General style

- Prefer simple, direct code over clever abstractions.
- Do not introduce a helper, factory, or type wrapper unless the same shape appears at least twice or hides genuine complexity.
- Identifiers must be descriptive. No single-letter names except short callback parameters (`map(x => x.id)`) or coordinates.
- A comment is allowed only when it explains a non-obvious *why* — a hidden constraint, an external bug, a workaround. Comments that restate the code are removed.
- `TODO` is allowed only with a concrete owner / ticket / condition. Otherwise it is removed.
- No commented-out code. Use git history.
- No empty `catch` blocks. Every caught error is either:
  1. inspected and translated into a domain `MinecraftKitError`,
  2. logged with structured context, or
  3. re-thrown unchanged.

A `catch` that is intentionally lossy must carry a one-line comment explaining *why* the loss is safe (e.g. cleanup of a temp file before throwing the real error).

---

## 2. TypeScript

- `any` is forbidden in source. If a third-party type is too loose, narrow it with a typed assertion at the boundary.
- `unknown` is allowed only for: `catch (e: unknown)`, structured logger context, and JSON parse output before validation.
- Public types live under `src/types/`. Internal helper types stay co-located with the file that uses them.
- Use union types or `as const` maps for finite sets (loader kinds, install phases, runtime architectures, event names). No magic strings in business logic.
- Magic numbers belong in `src/constants/` if they are reused or carry business meaning. One-off limits used inside a single file may stay inline if they are obvious from context.
- Imports of types must use `import type` (Biome enforces this).

### Discriminated unions
Discriminator field is always `kind` (loaders, install actions) or `type` (events). Do not invent new discriminator names.

### Error types
All thrown errors are `MinecraftKitError` with a stable `code`. New codes are added to `src/types/errors.ts`. Wrapping a lower-level error preserves it as `cause`.

---

## 3. File structure

- One file = one responsibility. A file longer than ~250 lines is reviewed for splitting.
- `src/cli/` may not import from anything except `src/index.ts` and `src/cli/*`. CLI must not reach into `src/install/`, `src/launch/`, etc. directly.
- `src/install/`, `src/launch/`, `src/verify/`, `src/repair/`, `src/versions/` may not import from `src/cli/`.
- `src/core/` may import only from `src/types/` and `src/constants/`. It is the lowest layer.
- Public API surface is `src/index.ts`. Anything not re-exported from there is internal and may be renamed or removed without notice.
- Re-exports from `src/index.ts` are explicit. No `export *` from internal modules.
- Test fixtures live in `tests/helpers/`. Tests do not import from each other.

### Naming
- File names use kebab-case: `forge-install.ts`, `version-resolution.ts`.
- Class names use PascalCase and end in their role: `Api`, `Client`, `Spawner`, `Error`.
- Functions are verbs: `planMinecraftRepair`, `resolveTarget`, `verifyHashedFile`.
- Booleans start with `is`, `has`, `should`, `can`.
- `Resolved*` prefix is reserved for the output of a resolver where a raw upstream
  shape with the bare name is already exported from the same module:
  `MinecraftVersionManifest` ↔ `ResolvedMinecraft`, `FabricProfile` ↔
  `ResolvedFabricLoader`, `ForgeInstallProfile` / `ForgeVersionJson` ↔
  `ResolvedForgeLoader`, `RuntimeFilesManifest` ↔ `ResolvedRuntime`.
  `ResolvedVanillaLoader` keeps the prefix to stay parallel inside the
  discriminated `Loader` union even though Vanilla has no raw counterpart.
  Do not add the prefix to types that lack a paired raw shape — `Target`,
  `*Summary` (listing entries), `MojangSession`, `LaunchComposition`,
  `InstallPlan`, and similar self-describing domain entities stay bare; the
  discovery output uses its own `Discovered*` prefix because the hint is
  filesystem-inferred, not verified.

---

## 4. Error handling

- Throw early, validate at boundaries (CLI input, public API entry points, HTTP responses).
- Internal helpers trust their callers — no defensive `if (!arg) throw` for arguments the type system already guarantees.
- A function may not return `null` to indicate failure when the failure deserves a stack trace. Return `null` only for genuine "not found / not present" semantics.
- Every public API rejection includes:
  - a stable `code` from `MinecraftKitError`,
  - a human message that names the operation and the resource,
  - structured `context` (target id, version, file path),
  - the underlying `cause` if wrapping.

CLI translates these into user-readable text in `src/cli/error-format.ts`. Domain code never formats user-facing strings.

---

## 5. Download / progress logic

- All HTTP traffic goes through the injected `HttpClient`. Direct `fetch()` is not allowed in domain code.
- All disk writes for downloaded artifacts go through `download.ts` (atomic temp + rename, on-the-fly hash).
- Concurrency is controlled exclusively by `pLimit` with a limit from `src/constants/defaults.ts`. No ad-hoc `Promise.all` over network calls.
- Progress events (`InstallProgressEvent`, `LaunchEvent`) are emitted only from the runner / spawner layer. Domain code returns plans, not events.
- The CLI is a *consumer* of progress events. It does not own progress state.

---

## 6. Process spawning

- Always use the injected `Spawner`. Never call `child_process.spawn` from outside `src/launch/spawner.ts`.
- Process arguments are constructed without shell interpolation. Never pass user data through `shell: true`.
- Abort logic is idempotent. Multiple `abort()` calls and signal handlers must not double-emit events.
- Stream buffers (stdout/stderr) have a bounded line length. Long lines are truncated rather than buffered indefinitely.

---

## 7. Tests

- Tests use real `FakeHttpClient` / `FakeSpawner`, not Vitest mocks.
- Network calls are forbidden in the test suite.
- Each test owns its temp directory (`mkdtemp(...)`), and cleans it up.
- Coverage targets: lines ≥ 80 %, branches ≥ 75 %, functions ≥ 80 %. Lower thresholds in `vitest.config.ts` are floors, not goals.

---

## 8. Documentation

Two doc trees:

| Tree | Audience | Tone |
|---|---|---|
| `docs/` | Maintainers, contributors, AI agents | Direct, technical, internal |
| `docs-site/` | Library / CLI users | Clear, example-first, no internals |

Rules for both:

- No filler ("This guide will help you…", "In this section we…").
- No marketing copy.
- No FAQ section unless every Q is something a real user has asked and no other doc answers.
- No mention of artefacts the library does not actually produce (profile files, session
  files, hidden launcher directories, etc.). The kit writes only `versions/`, `libraries/`,
  `assets/`, and (optionally) `runtime/`.
- Code samples are runnable as-is against the real public API.
- After any non-trivial code change in a module, the corresponding doc page is updated in the same PR.

---

## 9. Refactoring rules

- Behaviour-preserving unless a bug is identified and called out explicitly.
- Public API breakage is allowed pre-1.0. Call it out in the PR title (`feat!:` / `fix!:`)
  and description so it's findable in git history.
- New code replaces old code in the same change — no parallel "v2" implementations.
- Imports / exports / circular dependencies are checked after every module-level change (`npm run typecheck`).
- Lint and tests run after every module-level change. A failing test that is *unrelated* to the change is documented in the report; it is not silenced.
