# Install

Install is split into planning and execution. `plan()` produces actions; `run()` executes
them.

## Plan

```ts
const plan = await kit.install.plan(target);
console.log(`${plan.totalActions} actions, ${plan.totalBytes} bytes`);
```

`InstallPlan` carries every action the runner will perform: client jar + libraries + assets +
logging config + runtime files + (for Fabric/Forge) loader profile JSON and libraries + (for
Forge) processor invocations.

**Disk during planning.** Forge planning downloads the installer JAR into
`<directory>/forge-installers/` because it must read `install_profile.json` before it can
emit the rest of the plan. Legacy Forge installers may also extract the embedded universal
JAR into `libraries/` during planning so the generated version JSON points at an artifact
already present on disk. Vanilla, Fabric, and runtime planning are pure metadata.

## Run

```ts
await kit.install.run(plan, {
  onEvent: (event) => console.log(event.type),
  signal: controller.signal,
});
```

The runner:

- downloads files in parallel (`DOWNLOAD_CONCURRENCY = 32`);
- skips any download whose target file already matches the expected size + SHA-1;
- emits typed `download:*`, `integrity:*`, `archive:*`, `forge:*`, and
  `install:phase-changed` events;
- runs Forge processors sequentially using the installed Mojang JDK when the Forge profile
  declares processors;
- verifies each declared processor output file by SHA-1.

`run()` throws a `MinecraftKitError` on the first fatal failure (HTTP error after the
retry budget, hash mismatch, processor failure, abort signal). Per-file network failures that
are retryable are reflected via `download:failed` events with `willRetry: true` and do not
abort the operation.

### Pause and resume

Pass a `PauseController` for caller-driven pause/resume without aborting in-flight work:

```ts
import { PauseController } from "@loontail/minecraft-kit";

const pauseController = new PauseController();
const promise = kit.install.run(plan, { pauseController, onEvent });

// later:
pauseController.pause();   // freezes between chunks + between actions
pauseController.resume();
```

The runner checks the pause state at every stage boundary AND between chunks inside
`downloadFile`, so an in-flight download really does stop mid-body: the reader stops pulling
and resumes from where it left off. The HTTP request is not aborted, and the connection stays
open for the duration of the pause — a very long pause on a CDN that resets idle bodies will
make the read fail on resume, and the retry policy then re-issues the whole file (there is no
range-resume). Abort with `AbortSignal` is the cancellation primitive — `pause` is strictly
"freeze and continue later".

Pausing at a chunk boundary does not trip the download idle timeout (`DOWNLOAD_IDLE_TIMEOUT_MS`,
60s): the pause is awaited *before* the deadline is armed, so a parked transfer is never timed,
while a genuinely stalled connection is still failed with a retryable `NETWORK_TIMEOUT`. One edge
remains — a `pause()` issued while a read is already in flight cannot disarm that read's deadline,
and the retry policy does not consult the `PauseController`, so a socket that goes quiet at exactly
that moment burns the retry budget and restarts the file.

### Filtering categories

`run()` accepts `actionCategories: ReadonlySet<DownloadCategory>` to restrict the run to a
subset of categories. Useful for partial reinstalls. Categories are defined as a const
object:

```ts
import { DownloadCategories } from "@loontail/minecraft-kit";

await kit.install.run(plan, {
  actionCategories: new Set([
    DownloadCategories.CLIENT_JAR,
    DownloadCategories.LIBRARY,
    DownloadCategories.ASSET_INDEX,
    DownloadCategories.ASSET,
  ]),
});
```

The available categories: `CLIENT_JAR`, `LIBRARY`, `ASSET_INDEX`, `ASSET`,
`LOGGING_CONFIG`, `FABRIC_LIBRARY`, `FORGE_LIBRARY`, `RUNTIME_FILE`. (`FORGE_INSTALLER` also
exists, but only ever appears on download *events* raised while planning a Forge target — no plan
action carries it, so filtering on it does nothing.)

The filter covers the post-download steps that depend on those downloads, not just the downloads
themselves:

| Step | Runs only when the set contains |
| --- | --- |
| Native extraction | `LIBRARY` |
| Forge processors | `FORGE_LIBRARY` |
| Runtime symlinks/dirs (`materializeRuntimeExtras`) | `RUNTIME_FILE` |
| Version-JSON / logging-config writes | *always runs* |

Writes are unconditional on purpose: they are cheap and idempotent, and running them is what
leaves a partial run with a coherent tree on disk. An empty set is therefore a near-total no-op
that still reports `COMPLETED`.

### Mirror URLs

`DownloadAction.url` accepts either a single string or a `readonly string[]` of mirror
URLs. When an array is supplied, the runner tries each URL sequentially: each gets a full
retry budget, and the next URL is only consulted when the previous one's retries are
exhausted. Hash and size checks run per URL — a mirror serving a corrupted artifact is
treated like any other failure and falls back to the next URL.

`kit.install.plan(target)` currently generates single-URL actions; the array form is
intended for consumers building or augmenting plans by hand (CDN failover, local cache
mirrors, etc.). When every URL is exhausted, `downloadFile` throws `NETWORK_HTTP_ERROR`
with `context.urls` listing every URL attempted and `cause` set to an `AggregateError`
of the individual failures (or, for a single-URL action, the underlying failure
directly).

## Runtime-only installs

To install only a Java runtime, use the standalone flow:

```ts
const runtime = await kit.versions.runtime.resolve({
  system: kit.targets.system,
  component: "java-runtime-gamma",
});

const plan = await kit.install.runtime.planStandalone({
  id: "shared-jre",
  directory: "/opt/minecraft-runtimes",
  runtime,
});

await kit.install.runtime.run(plan, {
  onEvent: (event) => console.log(event.type),
});
```

`planStandalone` produces a regular `InstallPlan` with only runtime `DOWNLOAD_FILE` actions.

## Updates

An "update" is an install pass: the install runner skips files whose on-disk size and SHA-1
already match the manifest. `InstallReport.actionsSkipped` tells you how many files were
already current. There is no separate `kit.update.*` surface.
