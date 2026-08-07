# Internal documentation

Audience: maintainers, contributors, AI agents working on the codebase. **Not** end users —
user-facing docs live in `docs-site/`.

| File | Purpose |
|---|---|
| [`code-guidelines.md`](./code-guidelines.md) | Rules every change in this repo must follow. |
| [`architecture.md`](./architecture.md) | Internal layer map and ownership rules. |
| [`modules.md`](./modules.md) | One-paragraph summary per source module. |
| [`error-codes.md`](./error-codes.md) | Canonical list of `MinecraftKitErrorCode` values and when each fires. |
| [`ai-context.md`](./ai-context.md) | Conventions and gotchas for future AI agents. |

Build / lint / test / release commands live in [`CONTRIBUTING.md`](../CONTRIBUTING.md).
