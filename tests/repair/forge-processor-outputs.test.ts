import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { targetPaths } from "../../src/core/paths";
import { createMemoryCache } from "../../src/http/cache";
import { planForgeInstall } from "../../src/install/forge-install";
import { planForgeRepair } from "../../src/repair/forge";
import { type InstallAction, InstallActionKinds } from "../../src/types/install";
import { verifyForge } from "../../src/verify/forge";
import type { FakeHttpClient } from "../helpers/fake-http";
import {
  buildForgeTarget,
  createForgeHttp,
  FORGE_FULL_VERSION,
  FORGE_LIBRARY_BODY,
  FORGE_PATCHED_BODY,
  FORGE_PATCHED_RELATIVE,
  FORGE_SYSTEM,
  forgeInstallerWithProcessorBytes,
  forgeLoader,
  forgeMinecraft,
} from "../helpers/forge-fixture";

const FORGE_LIBRARY_RELATIVE = path.join(
  "net",
  "minecraftforge",
  "forge-extra",
  "47.2.0",
  "forge-extra-47.2.0.jar",
);

const processorActions = (actions: readonly InstallAction[]): readonly InstallAction[] =>
  actions.filter((action) => action.kind === InstallActionKinds.RUN_FORGE_PROCESSOR);

// AS-3: a broken generated output has to map back to the processor that produces it — no URL can
// repair it. This is the half the launcher used to hand-build by filtering an install plan.
describe("planForgeRepair — broken processor outputs", () => {
  let directory: string;
  let patchedJar: string;
  let http: FakeHttpClient;

  /** Verify with the patched JAR in the given state, then plan the repair that follows. */
  const planRepairWithOutput = async (body: string | undefined) => {
    if (body !== undefined) await fs.writeFile(patchedJar, body);
    const target = buildForgeTarget(directory);
    const cache = createMemoryCache();
    const verification = await verifyForge({ target, http, cache });
    return planForgeRepair({ target, http, cache, from: verification });
  };

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-forge-repair-proc-"));
    patchedJar = path.join(targetPaths.librariesDir(directory), FORGE_PATCHED_RELATIVE);
    http = createForgeHttp(forgeInstallerWithProcessorBytes());
    const plan = await planForgeInstall({
      loader: forgeLoader(),
      minecraft: forgeMinecraft(),
      directory,
      system: FORGE_SYSTEM,
      http,
      cache: createMemoryCache(),
    });
    await fs.mkdir(path.dirname(plan.versionJson.path), { recursive: true });
    await fs.writeFile(plan.versionJson.path, plan.versionJson.content);
    const library = path.join(targetPaths.librariesDir(directory), FORGE_LIBRARY_RELATIVE);
    await fs.mkdir(path.dirname(library), { recursive: true });
    await fs.writeFile(library, FORGE_LIBRARY_BODY);
    await fs.mkdir(path.dirname(patchedJar), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("re-runs the processor that declares the missing output", async () => {
    const plan = await planRepairWithOutput(undefined);

    expect(processorActions(plan.actions)).toHaveLength(1);
  });

  it("re-runs the processor for a hash-mismatched output", async () => {
    const plan = await planRepairWithOutput("patched-cli");

    expect(processorActions(plan.actions)).toHaveLength(1);
  });

  it("plans nothing once every generated output is correct", async () => {
    const plan = await planRepairWithOutput(FORGE_PATCHED_BODY);

    expect(plan.actions).toEqual([]);
  });

  // Verify reports the installer itself when it can no longer say what the processors should have
  // produced. Repair has to treat that as "re-run everything": the outputs on disk may be fine or
  // may be truncated, and nothing left on disk can tell the difference.
  it("re-runs every processor when verify could not read the installer", async () => {
    await fs.writeFile(patchedJar, FORGE_PATCHED_BODY);
    await fs.rm(targetPaths.forgeInstaller(directory, FORGE_FULL_VERSION));
    const target = buildForgeTarget(directory);
    const cache = createMemoryCache();
    const verification = await verifyForge({ target, http, cache });

    const plan = await planForgeRepair({ target, http, cache, from: verification });

    expect(processorActions(plan.actions)).toHaveLength(1);
  });
});
