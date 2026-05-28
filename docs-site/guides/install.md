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

**Disk during planning.** The only file written during `plan()` is the Forge installer
JAR. Forge planning needs to read `install_profile.json` from inside that JAR before it
can emit the rest of the plan, so the JAR is downloaded into `<directory>/forge-installers/`.
Vanilla, Fabric, and runtime planning are pure metadata.

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
- runs Forge processors sequentially using the installed Mojang JDK;
- verifies each processor's declared output files by SHA-1.

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
`downloadFile`. A pause does not interrupt an in-flight HTTP request; only the next
checkpoint will block. Abort with `AbortSignal` is the cancellation primitive — `pause` is
strictly "freeze and continue later".

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
`LOGGING_CONFIG`, `FABRIC_LIBRARY`, `FORGE_LIBRARY`, `RUNTIME_FILE`, `FORGE_INSTALLER`.

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

const plan = await kit.install.runtime.standalonePlan({
  id: "shared-jre",
  directory: "/opt/minecraft-runtimes",
  runtime,
});

await kit.install.runtime.run(plan, {
  onEvent: (event) => console.log(event.type),
});
```

`standalonePlan` produces a regular `InstallPlan` with only runtime `DOWNLOAD_FILE` actions.

## Updates

An "update" is an install pass: the install runner skips files whose on-disk size and SHA-1
already match the manifest. `InstallReport.actionsSkipped` tells you how many files were
already current. There is no separate `kit.update.*` surface.
