# Contributing

## Setup

- Node ≥ 20.11
- npm 10+ (ships with Node 20)

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
- **No `//` line comments** — only `/** … */` TSDoc blocks (including `@example`
  fences) survive. Rename helpers/constants so the why is implicit. The gate:

  ```bash
  grep -rnE '//' src tests | grep -vE ':\s+\*' | grep -v '://' | grep -v '/\\/'
  ```

  Must be empty. The filters strip TSDoc lines (` * …`), URL strings (`://`), and
  regex escapes (`/\/…`).
- **Plan / run split** for install / update / repair. Tests assert on plans.
- **Dependency injection** — never `vi.mock("node:child_process")`. Inject `Spawner` instead.
- **No network in tests.**

[`docs/modules.md`](./docs/modules.md) has a one-paragraph orientation per source folder.

## Commit & PR

[Conventional Commits](https://www.conventionalcommits.org/), enforced by `commit-msg`:

```
<type>[scope][!]: <description>
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`, `revert`. Suffix with `!` for breaking changes.

```
feat: add resolveVanillaLoader
fix(runner): close the readstream on abort
feat!: rename ElixirMinecraftKit to MinecraftKit
```

- One logical change per PR.
- Update the matching guide under `docs-site/guides/` when observable behaviour changes.
- `npm run docs:api` (TypeDoc) is manual — not required for the PR.

## Reporting bugs

Open an issue with a minimal reproduction: target id, loader, Minecraft version, failing
operation, full `MinecraftKitError` (code + message + context), platform, Node version. If
the failure is at install or repair, attach the `onEvent` log.

## Asking before writing

For new public API / loaders / CLI scenarios, open an issue first to align on scope.

## Publishing

The package ships with `publishConfig.provenance: true`, so every release must be cut
from a CI workflow with an OIDC-trusted publisher configured in npm — local
`npm publish` will fail. The release flow is:

1. Cut a release commit and tag (`chore(release)!: vX.Y.Z`).
2. Push the tag — the GitHub Actions release workflow runs on the `release: published`
   event, builds the kit, and runs `npm publish --access public --provenance`.
3. The workflow uses the npm "Trusted Publishers" feature, so no `NPM_TOKEN` secret
   is needed; npm verifies the GitHub OIDC token at publish time.

Manual `npm publish` from a workstation is unsupported. If you must reproduce the
publish flow locally, build the tarball with `npm pack`, inspect the output, and rely
on the workflow for the actual publish.
