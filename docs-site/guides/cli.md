# Interactive CLI: `mckit`

The `mckit` binary is fully interactive — no required arguments.

```bash
mckit
```

Flags: `--help` / `-h`, `--version` / `-v`, `--debug` (raw stack traces instead of the
friendly translation).

## Startup — pick how to play

When `mckit` launches, it asks once how you want to play before showing the main menu:

```text
○ Sign in with Microsoft   (opens your default browser — no codes to type)
○ Offline mode             (pick a username, no Microsoft account)
```

Microsoft sign-in opens the system browser via `rundll32 url.dll,FileProtocolHandler`
on Windows, `open` on macOS, and `xdg-open` on Linux. The CLI waits for the loopback
redirect and stores the resulting `MojangSession` in memory for the session — nothing is
written to disk.

If sign-in fails for any reason the CLI falls back to the offline prompt with a warning.

## Main menu

```text
○ Install Minecraft        — Vanilla / Fabric / Forge
○ Install Java/runtime
○ Verify installation
○ Repair installation
○ Launch Minecraft
○ Inspect installation
○ Account…                 — view session, refresh, switch, or sign out
○ Exit
```

Vanilla / Fabric / Forge are picked **inside** `Install Minecraft`, not as separate menu
entries.

## Install Minecraft flow

```text
Install Minecraft
→ Select Minecraft channel        (release / snapshot / old / all)
→ Select Minecraft version        (searchable list, top 50, type to filter)
→ Select Java/runtime             (auto-detect / pick specific component)
→ Select installation type        (Vanilla / Fabric / Forge)
→ Select Fabric loader            (only when type = Fabric)
→ Select Forge build              (only when type = Forge; recommended/latest first)
→ Select installation directory   (default / custom path)
→ Summary                         (Minecraft, Type, Loader, Runtime, Directory)
→ Confirm
→ Install with progress
```

Every list is API-driven. Free-form text is only accepted for the optional **Custom
path** and the player username at Launch time.

## Searchable picker

Long lists never render hundreds of options at once:

- **≤ 30 options** — shown directly with `← Back` / `✕ Cancel`.
- **> 30 options** — the picker first prompts for a filter string. Pressing Enter with
  an empty filter shows the first **50** entries (newest first) plus a
  `↻ Refine filter…` option. Typing a filter narrows the list before the select renders.
- Versions are deduplicated by id and sorted newest-first.
- `↻ Refine filter…` re-prompts in place — never drops you back to the previous wizard
  step.

## Compatibility checks

Every loader pick happens **after** the loader's compatibility list has been loaded for
the chosen Minecraft version. If Fabric or Forge has no published builds for the
selected Minecraft version (or the metadata server returns 4xx), the wizard prints a
friendly note and returns to the **install-type** picker — never to the main menu, and
never with a raw `NETWORK_HTTP_ERROR: HTTP 400 …` string.

## Progress UX

Install / Repair flows render a single throttled status line driven by typed progress
events from the core library:

```text
[downloading-libraries] 124/1532 · 84.3 MB/512.7 MB · 12.4 MB/s · active 32 · ████████░░ 58% · …libraries/net/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar
```

The line includes:

- Current install phase (`downloading-libraries`, `extracting-natives`, …).
- Files processed `X / Y`.
- Bytes downloaded `nn MB / mm MB`.
- Aggregate download speed (rolling 5-second window).
- `active N` — files downloading right now (capped by the worker-pool size).
- Textual progress bar (`████████░░ 58%`).
- Truncated current-file path.

The line is updated **in-place** through `spinner.message()` — it never produces a new
console line per event. Refresh rate is capped (default 250 ms) and identical lines are
deduped, so the console is never spammed. After the run, a summary note shows files
downloaded / skipped / failed, total bytes, average speed, and duration.

If `totalBytes` is unknown (zero-size manifests), the bar falls back to `—` while the
file counter, live speed, and active-downloads counter continue to update. There is **no
ETA** in any progress line, summary, event payload, or error message — by design.

## Account menu

The `Account…` entry from the main menu lets you:

- **Show session details** — uuid, username, expiry, XUID.
- **Refresh access token** — calls `kit.auth.refresh` with the stored refresh token.
- **Switch account** — runs the sign-in flow again with a different Microsoft account.
- **Sign out** — drops back to offline mode with a chosen username.

When the CLI is in offline mode, `Account…` simply re-prompts for sign-in.

## Verify / Repair / Launch / Inspect

All four pick an installation from the discovered list. If multiple Minecraft versions
live inside one installation directory, the wizard asks which one to operate on instead
of guessing.

- **Verify** runs the relevant aspect verifiers and prints any issues.
- **Repair** runs the install runner under the progress renderer, so the same UX applies
  to re-downloads as to fresh installs.
- **Launch** uses the active session (online) or the chosen offline username.
- **Inspect** never runs verification — only shows what's on disk: directory, all
  Minecraft versions, all detected loaders, runtime path / component / version.

## Errors

Every recoverable error goes through `formatUserError`, which translates each
`MinecraftKitError` code (and HTTP status) into a single-sentence user-friendly message:

- `NETWORK_HTTP_ERROR` 400/404 → "No matching data is available for that combination."
- `NETWORK_TIMEOUT` → "Network request timed out."
- `RUNTIME_NOT_FOUND` → "No runtime is published for that combination."

Pass `--debug` to surface raw stack traces instead.

## Programmatic CLI

The `runCli` helper exported from `@loontail/minecraft-kit/cli` lets tests script the
entire CLI against a stub UI:

```ts
import { runCli, createStubUi } from "@loontail/minecraft-kit/cli";

const ui = createStubUi([
  "offline",               // startup auth pick
  "Player",                // username
  "install-minecraft",     // main menu
  "release",               // channel
  versionSummary,          // searchable Minecraft picker
  "auto",                  // runtime: auto-detect
  "vanilla",               // install type
  "default",               // directory
  true,                    // confirm
  "exit",                  // back to menu → exit
]);
await runCli({ args: [], ui, rootDir: "./minecrafts" });
```

`createStubUi` records every prompt and notification (`ui.calls`) for assertion in
tests.
