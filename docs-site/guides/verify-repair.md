# Verify and repair

Verification and repair are aspect-based: `minecraft`, `fabric`, `forge`, `runtime`.
Run only the aspects that apply to the target.

## Verify

```ts
const minecraft = await kit.verify.minecraft.run(target);
const runtime = await kit.verify.runtime.run(target);

if (!minecraft.isValid) {
  for (const issue of minecraft.issues) {
    console.warn(`${issue.status}: ${issue.path}`);
  }
}
```

Each call returns a `VerificationResult`:

```ts
interface VerificationResult {
  readonly targetId: string;
  readonly kind: "minecraft" | "fabric" | "forge" | "runtime";
  readonly isValid: boolean;
  readonly issues: readonly VerificationFileResult[];
  readonly checkedFiles: number;
  readonly durationMs: number;
}
```

Each issue carries `status` (`missing`, `corrupt`, `wrong-size`), `category` (`client-jar`,
`library`, `asset`, `asset-index`, `native`, `loader-library`, `runtime-file`,
`logging-config`, `forge-processor-output`), and — when known — `expectedSha1`, `actualSha1`, `expectedSize`,
`actualSize`, and `url` (where to re-download from).

Pass `onEvent` to receive a `verify:file-checked` event per file. Events stream as the hashing pool
lands results, in input order — a bucket does not go silent until the last file is hashed.

`verify.forge` covers two classes of Forge file that no `DownloadAction` describes:

- the artifacts the installer's `maven/` flush wrote (recorded in
  `libraries/.forge-<fullVersion>.extracted`). They carry `url: ""`, so no download can restore
  one: existence is checked, and an issue there is fixed by re-planning the install, which
  re-extracts them.
- the artifacts the Forge **processors generate** — the srg/slim/extra/patched client JARs.
  `install_profile.json` declares a SHA-1 for each, so these are hash-checked and reported under
  the `forge-processor-output` category. The expected list is read from the installer JAR already
  on disk, so the check stays offline. Without it a truncated `<mc>-srg.jar` — what a cancelled or
  crashed install leaves behind — read as a valid Forge install and only surfaced as a crash
  inside Forge's bootstrap at launch.

Aspect verifiers that require a specific loader throw `INVALID_INPUT` when called on the
wrong loader (`verify.fabric.run` on a vanilla target, etc.).

For a launch gate, use the aggregate readiness API. It runs `minecraft`, `runtime`, and
the active loader aspect when one applies:

```ts
const readiness = await kit.verify.targetReady.run(target);

if (!readiness.isReady) {
  for (const issue of readiness.issues) {
    console.warn(`${issue.kind}: ${issue.status}: ${issue.path}`);
  }
}
```

`readiness.verifications` contains the underlying `VerificationResult[]`. Each flattened
`readiness.issues` entry also carries `kind`, so callers can route runtime, Minecraft, and
loader failures to different UI states.

## Repair

```ts
const plan = await kit.repair.minecraft.plan(target, { from: minecraft });
await kit.repair.minecraft.run(plan, {
  onEvent: (event) => console.log(event.type),
});
```

`plan` intersects the install plan with verification issues, so only broken or missing files
are touched. Repair uses the install runner, and `run` accepts the same controls the install
path does — `signal`, `pauseController`, and `actionCategories`:

```ts
import { PauseController } from "@loontail/minecraft-kit";

const pauseController = new PauseController();
const report = await kit.repair.minecraft.run(plan, { pauseController, onEvent });
```

`RepairReport` carries `actionsSkipped` next to `actionsCompleted`. Read them together: a Forge
repair deliberately re-emits every forge library (see below), so `actionsCompleted` on its own
cannot tell "re-downloaded 400 files" from "checked 400 files, fixed 2".

`kit.repair.all(target, options)` also takes a `pauseController`. It deliberately does **not**
take `actionCategories`: it already partitions the work per aspect, so a second category filter
on top would be ambiguous. Filter per aspect via `repair.<aspect>.run` instead.

`kit.repair.all` builds the install plan once and repairs every broken aspect from it, then
returns it as `report.installPlan` (`null` when nothing needed repairing). Reuse that plan for any
follow-on work on the same target instead of calling `kit.install.plan` again — for a Forge target
each extra plan means re-reading the installer archive.

`from` accepts a single `VerificationResult` *or* an array — useful if you ran more than one
aspect verifier:

```ts
const plan = await kit.repair.minecraft.plan(target, {
  from: [minecraft, await kit.verify.runtime.run(target)],
});
```

## One-call verify + repair

`kit.repair.verifyAndRepair` wraps the three-step `verify → plan → run` flow for a
single aspect into one call. It returns the verification result and, when a repair ran,
the repair report. In `RepairModes.REPORT` it never writes to disk:

```ts
import { RepairModes } from "@loontail/minecraft-kit";

// fix-on-find (default)
const { verification, repair } = await kit.repair.verifyAndRepair({
  aspect: "runtime",
  target,
});
if (repair !== null) console.log(`repaired ${repair.actionsCompleted} files`);

// diagnose only — show issues, ask the user, then call again with the default mode
const diagnosis = await kit.repair.verifyAndRepair({
  aspect: "minecraft",
  target,
  mode: RepairModes.REPORT,
});
if (!diagnosis.verification.isValid) askUserBeforeFixing(diagnosis.verification.issues);
```

`repair` is `null` whenever nothing was written: the target was already valid, the planner
produced an empty plan, or the mode was `RepairModes.REPORT`. Pass `onEvent` to receive
both `verify:file-checked` and the repair-time `install:phase-changed` / `download:*`
events.

Use the standalone surfaces when you need to inspect or confirm before writing.

## Repair semantics

- **`DOWNLOAD_FILE` actions** are included when the target path has *any* non-`native` issue
  recorded. A `native`-only issue at the JAR path means "re-extract", not "re-download".
- **`WRITE_VERSION_JSON` actions** are included when the destination path has any issue
  recorded.
- **`EXTRACT_NATIVE` actions** are included when the source JAR has any issue recorded.
- **`RUN_FORGE_PROCESSOR` actions** are included when a `forge-processor-output` issue names one
  of the files that processor declares — the only way to restore a generated artifact is to
  re-run the processor that produces it. A missing Forge version JSON pulls in *every* processor
  instead, since without the JSON nothing could be enumerated. Either trigger also re-emits every
  forge-library defensively: a processor's inputs and classpath are install-time libraries the
  verify pass does not necessarily cover, and running one against a missing input fails with a
  Java stack trace rather than a repairable issue. `downloadFile` skips files that are already
  correct, so the sweep costs one hash per file.

## Resume from a thrown error

When an install fails with a typed `MinecraftKitError`, you do not have to re-verify the
entire installation to fix the one broken artifact. Hand the error to
`kit.repair.fromError` and run the resulting plan:

```ts
import {
  isMinecraftKitError,
  MinecraftKitErrorCodes,
  RepairFromErrorSupportedCodes,
} from "@loontail/minecraft-kit";

try {
  await kit.install.run(plan);
} catch (error) {
  if (!isMinecraftKitError(error)) throw error;
  const supported = (Object.values(RepairFromErrorSupportedCodes) as string[]).includes(error.code);
  if (!supported) {
    const verification = await kit.verify.minecraft.run(target);
    const fullPlan = await kit.repair.minecraft.plan(target, { from: verification });
    await kit.repair.minecraft.run(fullPlan);
    return;
  }
  const resumePlan = await kit.repair.fromError({ error, target });
  await kit.repair.minecraft.run(resumePlan);
}
```

`kit.repair.fromError` recognises:

| Code | Resume strategy |
|---|---|
| `INTEGRITY_HASH_MISMATCH` / `INTEGRITY_SIZE_MISMATCH` | Re-download the single action whose URL matches `context.url`. |
| `NETWORK_HTTP_ERROR` / `NETWORK_TIMEOUT` | Re-download the action whose URL (or one of its mirror URLs) matches `context.url` / `context.urls`. `NETWORK_HTTP_ERROR` also accepts `context.filePath` for the destination match. |
| `FILESYSTEM_WRITE_ERROR` | Re-run the `DOWNLOAD_FILE`, `WRITE_VERSION_JSON`, or `WRITE_LOGGING_CONFIG` action that owns `context.filePath`. |
| `FORGE_PROCESSOR_FAILED` | Re-run the entire Forge processor stage — every `FORGE_LIBRARY` download, the forge version JSON write, and every `RUN_FORGE_PROCESSOR`. We do not pinpoint a single processor by `mainClass`: the chain is sequential and one failure typically invalidates everything downstream. |

Any other error code throws `INVALID_INPUT` — those failures need the regular
`verify → plan → run` flow because their recovery is not encoded in the error context.
A code in the supported set that nonetheless does not match any planned action also throws
`INVALID_INPUT` (the install plan no longer mentions the broken URL or path, so
`fromError` cannot construct a useful repair).
