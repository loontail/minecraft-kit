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
  FORGE_MAVEN_ENTRY_RELATIVE,
  FORGE_SYSTEM,
  forgeLoader,
  forgeMinecraft,
} from "../helpers/forge-fixture";

// Installer-embedded artifacts carry `url: ""`, so they appear in no DownloadAction and used to be
// invisible to verify.forge — an antivirus quarantine of the universal JAR read as a valid install
// while launch died on a missing classpath entry.
describe("verifyForge — installer-embedded artifacts", () => {
  let directory: string;
  let mavenArtifact: string;
  let http: FakeHttpClient;

  const verify = () =>
    verifyForge({
      target: buildForgeTarget(directory),
      http,
      cache: createMemoryCache(),
    });

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-forge-verify-"));
    mavenArtifact = path.join(targetPaths.librariesDir(directory), FORGE_MAVEN_ENTRY_RELATIVE);
    http = createForgeHttp();
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
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("checks the extracted artifacts and reports no issue while they are present", async () => {
    const result = await verify();

    expect(result.issues.some((issue) => issue.path === mavenArtifact)).toBe(false);
    // Forge version JSON + the one downloadable library + the one embedded artifact.
    expect(result.checkedFiles).toBe(3);
  });

  it("reports a removed embedded artifact as missing", async () => {
    await fs.rm(mavenArtifact);

    const result = await verify();

    const issue = result.issues.find((candidate) => candidate.path === mavenArtifact);
    expect(issue?.status).toBe(VerifyFileStatuses.MISSING);
    expect(issue?.category).toBe(VerifyFileCategories.LOADER_LIBRARY);
    expect(result.isValid).toBe(false);
  });

  it("records nothing extra for a target that never flushed an installer", async () => {
    await fs.rm(
      path.join(targetPaths.librariesDir(directory), `.forge-${FORGE_FULL_VERSION}.extracted`),
    );

    const result = await verify();

    expect(result.issues.some((issue) => issue.path === mavenArtifact)).toBe(false);
    expect(result.checkedFiles).toBe(2);
  });
});
