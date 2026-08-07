import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { targetPaths } from "../../src/core/paths";
import { createMemoryCache } from "../../src/http/cache";
import { planForgeInstall } from "../../src/install/forge-install";
import { planForgeRepair } from "../../src/repair/forge";
import type { ResolvedForgeLoader } from "../../src/types/forge";
import { type InstallAction, InstallActionKinds } from "../../src/types/install";
import type { Target } from "../../src/types/target";
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

/**
 * The real relationship between the two Forge version strings, which the shared fixture collapses:
 * `loader.fullVersion` is the Maven version, and the version id the installer writes carries the
 * `-forge-` infix. A test in which the two are equal cannot see a path built from the wrong one.
 */
const MAVEN_FULL_VERSION = "1.20.1-47.2.0";

const realisticForgeLoader = (): ResolvedForgeLoader => ({
  ...forgeLoader(),
  fullVersion: MAVEN_FULL_VERSION,
});

const realisticForgeTarget = (directory: string): Target => ({
  ...buildForgeTarget(directory),
  loader: realisticForgeLoader(),
});

const versionJsonActions = (actions: readonly InstallAction[]): readonly string[] =>
  actions
    .filter((action) => action.kind === InstallActionKinds.WRITE_VERSION_JSON)
    .map((action) => action.path);

const processorActions = (actions: readonly InstallAction[]): readonly InstallAction[] =>
  actions.filter((action) => action.kind === InstallActionKinds.RUN_FORGE_PROCESSOR);

describe("planForgeRepair — Maven version vs. written version id", () => {
  let directory: string;
  let http: FakeHttpClient;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-forge-version-id-"));
    http = createForgeHttp(forgeInstallerWithProcessorBytes());
    const plan = await planForgeInstall({
      loader: realisticForgeLoader(),
      minecraft: forgeMinecraft(),
      directory,
      system: FORGE_SYSTEM,
      http,
      cache: createMemoryCache(),
    });
    expect(plan.versionJson.path).toBe(targetPaths.versionJson(directory, FORGE_FULL_VERSION));
    const library = path.join(targetPaths.librariesDir(directory), FORGE_LIBRARY_RELATIVE);
    await fs.mkdir(path.dirname(library), { recursive: true });
    await fs.writeFile(library, FORGE_LIBRARY_BODY);
    const patchedJar = path.join(targetPaths.librariesDir(directory), FORGE_PATCHED_RELATIVE);
    await fs.mkdir(path.dirname(patchedJar), { recursive: true });
    await fs.writeFile(patchedJar, FORGE_PATCHED_BODY);
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  // The version directory is absent entirely — what an interrupted install or a hand-deleted
  // versions/ folder leaves behind. Repair must rewrite the JSON at the id the install plan uses
  // and re-run the processors that depend on it.
  it("rewrites the Forge version JSON the install plan writes", async () => {
    const target = realisticForgeTarget(directory);
    const cache = createMemoryCache();
    const verification = await verifyForge({ target, http, cache });

    const plan = await planForgeRepair({ target, http, cache, from: verification });

    expect(versionJsonActions(plan.actions)).toEqual([
      targetPaths.versionJson(directory, FORGE_FULL_VERSION),
    ]);
    expect(processorActions(plan.actions)).toHaveLength(1);
  });

  // The vanilla version JSON lives in the same plan and is repaired by the Minecraft aspect;
  // selecting "every WRITE_VERSION_JSON that is not the vanilla one" must not swallow it.
  it("leaves the vanilla version JSON to the Minecraft aspect", async () => {
    const target = realisticForgeTarget(directory);
    const cache = createMemoryCache();
    const verification = await verifyForge({ target, http, cache });

    const plan = await planForgeRepair({ target, http, cache, from: verification });

    expect(versionJsonActions(plan.actions)).not.toContain(
      targetPaths.versionJson(directory, target.minecraft.version),
    );
  });
});
