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
  FORGE_PATCHED_BODY,
  FORGE_PATCHED_RELATIVE,
  FORGE_SYSTEM,
  forgeInstallerWithProcessorBytes,
  forgeLoader,
  forgeMinecraft,
  legacyForgeInstallerBytes,
} from "../helpers/forge-fixture";
import { sha1OfBytes } from "../helpers/hash";

const FORGE_LIBRARY_RELATIVE = path.join(
  "net",
  "minecraftforge",
  "forge-extra",
  "47.2.0",
  "forge-extra-47.2.0.jar",
);

// AS-3: Forge processors generate the srg/slim/extra/patched client JARs. `install_profile.json`
// publishes a SHA-1 for each, but nothing downloads them, so they appear in no DownloadAction —
// verify.forge used to call a Forge install with a truncated <mc>-srg.jar valid, and the launcher
// carried 221 lines of its own detect-and-re-run code to compensate.
describe("verifyForge — generated processor outputs", () => {
  let directory: string;
  let patchedJar: string;
  let http: FakeHttpClient;

  const verify = () =>
    verifyForge({
      target: buildForgeTarget(directory),
      http,
      cache: createMemoryCache(),
    });

  const writePatchedJar = (body: string) => fs.writeFile(patchedJar, body);

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-forge-processors-"));
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

  it("reports a valid install once the generated output matches its declared sha1", async () => {
    await writePatchedJar(FORGE_PATCHED_BODY);

    const result = await verify();

    expect(result.issues).toEqual([]);
    expect(result.isValid).toBe(true);
    // Forge version JSON + the downloadable library + the embedded maven artifact + the output.
    expect(result.checkedFiles).toBe(4);
  });

  it("reports a never-generated output as missing", async () => {
    const result = await verify();

    const issue = result.issues.find((candidate) => candidate.path === patchedJar);
    expect(issue?.status).toBe(VerifyFileStatuses.MISSING);
    expect(issue?.category).toBe(VerifyFileCategories.FORGE_PROCESSOR_OUTPUT);
    expect(issue?.expectedSha1).toBe(sha1OfBytes(FORGE_PATCHED_BODY));
    expect(result.isValid).toBe(false);
  });

  it("reports a half-written output as corrupt", async () => {
    await writePatchedJar("patched-cli");

    const result = await verify();

    const issue = result.issues.find((candidate) => candidate.path === patchedJar);
    expect(issue?.status).toBe(VerifyFileStatuses.CORRUPT);
    expect(issue?.category).toBe(VerifyFileCategories.FORGE_PROCESSOR_OUTPUT);
    expect(issue?.actualSha1).toBe(sha1OfBytes("patched-cli"));
  });

  it("stays offline and leaves the installer untouched", async () => {
    await writePatchedJar(FORGE_PATCHED_BODY);
    const requestsAfterPlanning = http.requests.length;

    await verify();

    expect(http.requests.length).toBe(requestsAfterPlanning);
  });

  // Fail-closed: "no outputs to check" and "cannot tell what the outputs should be" must not
  // produce the same clean report. Nothing else in verify.forge looks at the installer JAR, so
  // without this the generated artifacts go silently unchecked and repair reports a clean target.
  it("reports the installer as missing when it is no longer on disk", async () => {
    await writePatchedJar(FORGE_PATCHED_BODY);
    const installerPath = targetPaths.forgeInstaller(directory, FORGE_FULL_VERSION);
    await fs.rm(installerPath);

    const result = await verify();

    expect(result.issues).toEqual([
      {
        path: installerPath,
        category: VerifyFileCategories.LOADER_LIBRARY,
        status: VerifyFileStatuses.MISSING,
      },
    ]);
    expect(result.isValid).toBe(false);
  });

  // An installer that no longer reads must not turn a verification into a throw either: it is
  // reported as a broken file like any other, and repair re-downloads it before re-running the
  // processors whose outputs it can no longer describe.
  it("reports the installer as corrupt when it no longer parses", async () => {
    await writePatchedJar(FORGE_PATCHED_BODY);
    const installerPath = targetPaths.forgeInstaller(directory, FORGE_FULL_VERSION);
    await fs.writeFile(installerPath, "not-a-zip");

    const result = await verify();

    expect(result.issues).toEqual([
      {
        path: installerPath,
        category: VerifyFileCategories.LOADER_LIBRARY,
        status: VerifyFileStatuses.CORRUPT,
      },
    ]);
    expect(result.isValid).toBe(false);
  });

  it("checks nothing generated for a legacy 1.7.x profile, which has no processors", async () => {
    await fs.writeFile(
      targetPaths.forgeInstaller(directory, FORGE_FULL_VERSION),
      legacyForgeInstallerBytes(),
    );

    const result = await verify();

    expect(result.issues).toEqual([]);
    expect(result.checkedFiles).toBe(3);
  });
});
