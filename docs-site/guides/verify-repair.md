# Verify and repair

Verification and repair share an aspect-based shape: `minecraft`, `fabric`, `forge`,
`runtime`. You run only the aspects that apply to your target.

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
`logging-config`), and — when known — `expectedSha1`, `actualSha1`, `expectedSize`,
`actualSize`, and `url` (where to re-download from).

Pass `onEvent` to receive a `verify:file-checked` event per file.

Aspect verifiers that require a specific loader throw `INVALID_INPUT` when called on the
wrong loader (`verify.fabric.run` on a vanilla target, etc.).

## Repair

```ts
const plan = await kit.repair.minecraft.plan(target, { from: minecraft });
await kit.repair.minecraft.run(plan, {
  onEvent: (event) => console.log(event.type),
});
```

`plan` intersects the install plan with the verification issues so only broken / missing
files get touched. The install runner executes the repair — there is no separate runner to
drift apart from install behaviour, and `actionsSkipped` in the resulting report tells you
how many files were already correct.

`from` accepts a single `VerificationResult` *or* an array — useful if you ran more than one
aspect verifier:

```ts
const plan = await kit.repair.minecraft.plan(target, {
  from: [minecraft, await kit.verify.runtime.run(target)],
});
```

## One-call verify + repair

`kit.repair.runVerifyAndRepair` wraps the three-step `verify → plan → run` flow for a
single aspect into one call. It returns the verification result and, when a repair ran,
the repair report. In `RepairModes.REPORT` it never writes to disk:

```ts
import { RepairModes } from "@loontail/minecraft-kit";

// fix-on-find (default)
const { verified, repair } = await kit.repair.runVerifyAndRepair({
  aspect: "runtime",
  target,
});
if (repair !== null) console.log(`repaired ${repair.actionsCompleted} files`);

// diagnose only — show issues, ask the user, then call again with the default mode
const diagnosis = await kit.repair.runVerifyAndRepair({
  aspect: "minecraft",
  target,
  mode: RepairModes.REPORT,
});
if (!diagnosis.verified.isValid) askUserBeforeFixing(diagnosis.verified.issues);
```

`repair` is `null` whenever nothing was written: the target was already valid, the planner
produced an empty plan, or the mode was `RepairModes.REPORT`. Pass `onEvent` to receive
both `verify:file-checked` and the repair-time `install:phase-changed` / `download:*`
events.

The standalone surfaces (`kit.verify.<aspect>.run`, `kit.repair.<aspect>.plan/run`) stay —
this helper is only the convenience case for "find and fix this one aspect now".

## Repair semantics

- **`DOWNLOAD_FILE` actions** are included when the target path has *any* non-`native` issue
  recorded. A `native`-only issue at the JAR path means "re-extract", not "re-download".
- **`WRITE_VERSION_JSON` actions** are included when the destination path has any issue
  recorded.
- **`EXTRACT_NATIVE` actions** are included when the source JAR has any issue recorded.
- **Forge processors** are normally not in a repair plan, since they only need to fire on a
  fresh install. When the Forge version JSON is missing entirely the planner adds every
  forge-library plus all processors as a defensive sweep — `downloadFile` skips files that
  are already correct, so the cost is bounded.

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
| `FORGE_PROCESSOR_FAILED` | Re-run the entire Forge processor stage — every `FORGE_LIBRARY` / `FORGE_INSTALLER` download, the forge version JSON write, and every `RUN_FORGE_PROCESSOR`. We do not pinpoint a single processor by `mainClass`: the chain is sequential and one failure typically invalidates everything downstream. |

Any other error code throws `INVALID_INPUT` — those failures need the regular
`verify → plan → run` flow because their recovery is not encoded in the error context.
A code in the supported set that nonetheless does not match any planned action also throws
`INVALID_INPUT` (the install plan no longer mentions the broken URL or path, so
`fromError` cannot construct a useful repair).
