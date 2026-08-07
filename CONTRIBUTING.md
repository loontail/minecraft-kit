# Contributing

## Setup

- Node ≥ 22.12
- npm 10+ (ships with Node 22)

```bash
git clone <your-fork>
cd minecraft-kit
npm install
```

`npm install` installs the git hooks via husky's `prepare` script.

## Git hooks

| Hook | Runs |
|---|---|
| `commit-msg` | commitlint (Conventional Commits) |
| `pre-commit` | lint-staged (biome on staged files) + `npm run typecheck` |
| `pre-push` | `npm run test:coverage` + `npm run build` |

Don't bypass with `--no-verify` — CI runs the same checks.

## Commands

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` against the strict tsconfig. |
| `npm run lint` | `biome check ./src ./tests`. |
| `npm run lint:fix` | Apply safe Biome fixes. |
| `npm run format` | Apply Biome formatting only. |
| `npm test` | Run the full Vitest suite once. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run test:coverage` | Vitest with `--coverage` (v8 provider). |
| `npm run build` | tsup bundle to `dist/` (library + CLI + sourcemaps + declarations). |
| `npm run docs:api` | TypeDoc → `docs-site/api/`. |
| `npm run docs:dev` | TypeDoc → VitePress dev server. |
| `npm run docs:build` | TypeDoc → VitePress static build. |

Before opening a PR, all four must pass:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

## Project conventions

Full rules: [`docs/code-guidelines.md`](./docs/code-guidelines.md). Highlights:

- **No `any`** — narrow at the boundary.
- **No magic strings** — finite sets live in `const` maps under `src/types/` or `src/constants/`.
- **No silent `catch`** — inspect, log, or re-throw; lossy catches need a one-line comment.
- **Default to no comments** ([`docs/code-guidelines.md`](./docs/code-guidelines.md) §1). A
  comment earns its place only when it records a non-obvious invariant or a genuine
  workaround — a protocol quirk, an ordering constraint, an upstream bug. `// why: …` is the
  preferred form for those; it is short and it says out loud that the line is a *why*, not a
  restatement. Comments that restate the code, narrate deleted code ("used to", "no longer",
  "previously"), or date themselves ("now") are deleted on sight.
- **TSDoc is for the public surface only** — the symbols re-exported from `src/index.ts`,
  because `npm run docs:api` publishes them. Internal modules follow the default-no-comments
  rule. An `@example` must show something a caller cannot infer from the signature; do not
  put one on a plain type alias.
- **Plan / run split** for install / update / repair. Tests assert on plans.
- **Dependency injection** — never `vi.mock`. Inject `Spawner` / `HttpClient`; the fakes in
  `tests/helpers/` exist for exactly this.
- **No network in tests.** All HTTP is scripted, and each test owns its temp directory
  (`mkdtemp(...)`) and cleans it up.

[`docs/modules.md`](./docs/modules.md) has a one-paragraph orientation per source folder.

## Commit & PR

[Conventional Commits](https://www.conventionalcommits.org/), enforced by `commit-msg`:

```
<type>[scope][!]: <description>
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`, `revert`. Suffix with `!` for breaking changes — there is no CHANGELOG, so
`git log --grep='!:'` is the breaking-change record.

```
feat: add resolveVanillaLoader
fix(runner): close the readstream on abort
feat!: rename ElixirMinecraftKit to MinecraftKit
```

- One logical change per PR.
- Update the matching guide under `docs-site/guides/` when observable behaviour changes.
- If you touched `src/types/` or the public surface in `src/index.ts`, run `npm run docs:api`
  and check the generated pages. It is manual — not required for the PR.

## Reporting bugs

Open an issue with a minimal reproduction: target id, loader, Minecraft version, failing
operation, full `MinecraftKitError` (code + message + context), platform, Node version. If
the failure is at install or repair, attach the `onEvent` log.

## Asking before writing

For new public API / loaders / CLI scenarios, open an issue first to align on scope.

## Publishing

Releases are push-driven by [`.github/workflows/release.yml`](./.github/workflows/release.yml),
which is authoritative — read it before changing anything here.

- Every push to `main` bumps the version, pushes a `chore(release): vX.Y.Z` commit and matching
  tag back to `main`, re-runs typecheck / lint / test / build, publishes with
  `npm publish --provenance --access public`, and cuts a GitHub Release.
- The **bump level is derived from your commit messages** since the last tag — which is why the
  conventional-commit rules above are load-bearing: `!` or a `BREAKING CHANGE` footer bumps the
  minor while the package is `0.x` (and the major from `1.0.0` on), `feat` bumps the minor,
  anything else bumps the patch. A breaking change committed without `!` ships as a patch.
- The bump commit would re-trigger the workflow, so a guard job short-circuits when the head
  commit message starts with `chore(release):`.
- **To override the level:** bump locally with `npm version <level> --no-git-tag-version`,
  commit as `chore(release): vX.Y.Z`, and push. The guard skips that push; the next ordinary
  commit on `main` releases from the new baseline.
- Required secrets: `NPM_TOKEN` (npm automation token with publish scope) and `RELEASE_TOKEN`
  (fine-grained PAT that may push to protected `main`).

Manual `npm publish` from a workstation is unsupported: `publishConfig.provenance: true`
requires the workflow's OIDC token. To inspect what would ship, run `npm pack`.
