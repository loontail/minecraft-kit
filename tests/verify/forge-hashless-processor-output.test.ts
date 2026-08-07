import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { targetPaths } from "../../src/core/paths";
import { createMemoryCache } from "../../src/http/cache";
import { planForgeInstall } from "../../src/install/forge-install";
import { VerifyFileCategories, VerifyFileStatuses } from "../../src/types/verify";
import { verifyForge } from "../../src/verify/forge";
import type { FakeHttpClient } from "../helpers/fake-http";
import {
  buildForgeTarget,
  createForgeHttp,
  FORGE_FULL_VERSION,
  FORGE_LIBRARY_BODY,
  FORGE_PATCHED_RELATIVE,
  FORGE_SYSTEM,
  forgeLoader,
  forgeMinecraft,
  installerBytesWithProfile,
} from "../helpers/forge-fixture";

const FORGE_LIBRARY_RELATIVE = path.join(
  "net",
  "minecraftforge",
  "forge-extra",
  "47.2.0",
  "forge-extra-47.2.0.jar",
);

/**
 * Installer whose only processor declares its output with no hash — the shape a Forge profile
 * takes when the `{..._SHA}` token it substitutes resolves to an empty string.
 */
const hashlessOutputInstallerBytes = (): Buffer =>
  installerBytesWithProfile({
    spec: 1,
    profile: "forge",
    version: FORGE_FULL_VERSION,
    minecraft: "1.20.1",
    json: "/version.json",
    data: { PATCHED: { client: "[net.minecraftforge:forge:47.2.0:client]", server: "" } },
    libraries: [],
    processors: [
      {
        sides: ["client"],
        jar: "net.minecraftforge:installertools:1.3.0",
        classpath: [],
        args: ["--task", "BUNDLER_EXTRACT", "--output", "{PATCHED}"],
        outputs: { "{PATCHED}": "" },
      },
    ],
  });

// A hashless output used to be dropped from the list entirely, so it lost even its existence
// check. Existence is the strongest check available for it — and the only one that does not
// re-run the processor on every repair forever, which comparing a real digest against "" did.
describe("verifyForge — processor output with no declared hash", () => {
  let directory: string;
  let patchedJar: string;
  let http: FakeHttpClient;

  const verify = () =>
    verifyForge({
      target: buildForgeTarget(directory),
      http,
      cache: createMemoryCache(),
    });

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-forge-hashless-"));
    patchedJar = path.join(targetPaths.librariesDir(directory), FORGE_PATCHED_RELATIVE);
    http = createForgeHttp(hashlessOutputInstallerBytes());
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

  it("reports a never-generated hashless output as missing", async () => {
    const result = await verify();

    expect(result.issues).toEqual([
      {
        path: patchedJar,
        category: VerifyFileCategories.FORGE_PROCESSOR_OUTPUT,
        status: VerifyFileStatuses.MISSING,
      },
    ]);
    expect(result.isValid).toBe(false);
  });

  it("accepts any content for a hashless output that exists", async () => {
    await fs.writeFile(patchedJar, "whatever-the-processor-wrote");

    const result = await verify();

    expect(result.issues).toEqual([]);
    // Forge version JSON + the downloadable library + the embedded maven artifact + the output.
    expect(result.checkedFiles).toBe(4);
  });
});
