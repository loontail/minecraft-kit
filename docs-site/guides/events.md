# Progress events

Every long-running operation accepts an `onEvent` callback. Events form a discriminated
union, so a `switch` on `event.type` gives you exhaustiveness checking. Compare against
`EventTypes` to avoid magic strings:

```ts
import type { ProgressEvent } from "@loontail/minecraft-kit";
import { EventTypes } from "@loontail/minecraft-kit";

function handle(e: ProgressEvent) {
  switch (e.type) {
    case EventTypes.INSTALL_PHASE_CHANGED:
      ui.setPhase(e.phase);
      break;
    case EventTypes.DOWNLOAD_PROGRESS:
      ui.updateBar(e.file, e.bytesDownloaded, e.totalBytes);
      break;
    case EventTypes.DOWNLOAD_SKIPPED:
      ui.markSkipped(e.file);
      break;
    case EventTypes.FORGE_PROCESSOR_STARTED:
      ui.note(`Running processor ${e.processor.index + 1}/${e.total}`);
      break;
    case EventTypes.LAUNCH_STDOUT:
      console.log(e.line);
      break;
  }
}
```

## Event groups

| Group | Events |
|---|---|
| Phase | `install:phase-changed` |
| Download | `download:started`, `download:progress`, `download:skipped`, `download:completed`, `download:failed` |
| Integrity | `integrity:verified`, `integrity:mismatch` |
| Archive | `archive:extracted` |
| Forge | `forge:processor-started`, `forge:processor-completed`, `forge:processor-output-verified` |
| Verify | `verify:file-checked` |
| Launch | `launch:starting`, `launch:started`, `launch:stdout`, `launch:stderr`, `launch:exited`, `launch:aborted` |

The full payload of each event is in the [API reference](../api/).

## Aggregating events for a UI

`download:progress` fires once per chunk and per file — far too noisy to bind directly
to a progress bar. `createInstallProgressTracker` is the supported way to fold raw events
into coarse UI-oriented progress stages with throttled snapshots. The five stages are
exposed as the `ProgressStages` as-const map (literal type `ProgressStage`):
`PREPARE`, `RUNTIME`, `MINECRAFT`, `LOADER`, `FINALIZE`.

```ts
import {
  createInstallProgressTracker,
  ProgressStages,
  type ProgressStage,
} from "@loontail/minecraft-kit";

const tracker = createInstallProgressTracker(plan, { throttleMs: 100 });

const label: Record<ProgressStage, string> = {
  [ProgressStages.PREPARE]: "Preparing…",
  [ProgressStages.RUNTIME]: "Installing Java",
  [ProgressStages.MINECRAFT]: "Downloading game",
  [ProgressStages.LOADER]: "Installing mod loader",
  [ProgressStages.FINALIZE]: "Done",
};

const unsubscribe = tracker.subscribe((snapshot) => {
  ui.render(label[snapshot.stage], snapshot.overallPercent, snapshot.currentFile);
});

await kit.install.run(plan, { onEvent: tracker.onEvent });
tracker.finish();
unsubscribe();
```

The snapshot carries `stage` (a `ProgressStage`), `stagePercent`, `overallPercent`,
`bytesDownloaded`, `totalBytes`, and `currentFile`. See the [API reference](../api/) for
the full type.

`ProgressStages` are deliberately separate from `InstallPhases`: the latter is the
fine-grained sequence the install runner walks through (`PLANNING`,
`DOWNLOADING_CLIENT_JAR`, `EXTRACTING_NATIVES`, `RUNNING_FORGE_PROCESSORS`, …) and the
discriminator of `install:phase-changed`. `ProgressStages` is the coarser UI grouping the
tracker folds those phases into; nothing else in the kit consumes it.

## What the event stream does *not* carry

- **No ETA.** `download:completed` exposes `durationMs` (real elapsed wall-clock time)
  and `forge:processor-completed` does the same for processors. ETA prediction is
  intentionally absent from the core; build it in the renderer if you need it.
- **No total-size guess when unknown.** When neither the manifest nor the HTTP response
  declares a content length, `download:started.expectedSize` and
  `download:progress.totalBytes` are `0`. Renderers should treat zero as "unknown" and
  fall back to byte count + speed.

## Errors vs events

Recoverable per-file issues (`download:failed` with `willRetry: true`,
`integrity:mismatch`) are emitted through the listener. Fatal failures throw —
`install.run` / `repair.run` / `launch.compose` / `launch.run` reject with a
`MinecraftKitError`. This keeps the happy path linear and prevents accidental
swallowing of fatal errors when a listener is missing.
