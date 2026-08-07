import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MinecraftKitErrorCodes } from "../../src/core/errors";
import { targetPaths } from "../../src/core/paths";
import { createMemoryCache } from "../../src/http/cache";
import { planForgeInstall } from "../../src/install/forge-install";
import { planInstall } from "../../src/install/planner";
import { DownloadCategories, InstallActionKinds } from "../../src/types/install";
import type { FakeHttpClient } from "../helpers/fake-http";
import {
  buildForgeTarget,
  countRequests,
  createForgeHttp,
  FORGE_FULL_VERSION,
  FORGE_INSTALLER_URL,
  FORGE_MAVEN_ENTRY_RELATIVE,
  FORGE_SYSTEM,
  forgeLoader,
  forgeMinecraft,
  installerBytesWithProfile,
  installerWithUnreadableMavenEntry,
} from "../helpers/forge-fixture";

describe("planForgeInstall — installer reuse", () => {
  let directory: string;
  let installerPath: string;
  let mavenArtifact: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-forge-plan-"));
    installerPath = targetPaths.forgeInstaller(directory, FORGE_FULL_VERSION);
    mavenArtifact = path.join(targetPaths.librariesDir(directory), FORGE_MAVEN_ENTRY_RELATIVE);
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  const plan = (http: FakeHttpClient) =>
    planForgeInstall({
      loader: forgeLoader(),
      minecraft: forgeMinecraft(),
      directory,
      system: FORGE_SYSTEM,
      http,
      cache: createMemoryCache(),
    });

  it("downloads the installer once across repeated planning calls", async () => {
    const http = createForgeHttp();
    await plan(http);
    await plan(http);
    await plan(http);
    expect(countRequests(http, FORGE_INSTALLER_URL)).toBe(1);
  });

  it("flushes the embedded maven tree only on the first call", async () => {
    const http = createForgeHttp();
    await plan(http);
    expect(await fs.readFile(mavenArtifact, "utf8")).toBe("forge-jar");

    await fs.writeFile(mavenArtifact, "untouched-marker");
    await plan(http);
    expect(await fs.readFile(mavenArtifact, "utf8")).toBe("untouched-marker");
  });

  it("re-extracts when libraries/ (and with it the sentinel) is deleted by hand", async () => {
    const http = createForgeHttp();
    await plan(http);
    await fs.rm(targetPaths.librariesDir(directory), { recursive: true, force: true });

    await plan(http);
    expect(await fs.readFile(mavenArtifact, "utf8")).toBe("forge-jar");
    expect(countRequests(http, FORGE_INSTALLER_URL)).toBe(1);
  });

  it("re-downloads an installer on disk that no longer parses", async () => {
    const http = createForgeHttp();
    await fs.mkdir(path.dirname(installerPath), { recursive: true });
    await fs.writeFile(installerPath, "not-a-zip-at-all");

    const result = await plan(http);
    expect(result.versionId).toBe(FORGE_FULL_VERSION);
    expect(countRequests(http, FORGE_INSTALLER_URL)).toBe(1);
  });

  // The embedded artifacts carry `url: ""`, so no download can restore one — re-extracting is the
  // only self-heal path, and the sentinel must not claim a flush whose output is gone.
  it("re-extracts when an artifact the sentinel recorded has been removed", async () => {
    const http = createForgeHttp();
    await plan(http);
    await fs.rm(mavenArtifact);

    await plan(http);
    expect(await fs.readFile(mavenArtifact, "utf8")).toBe("forge-jar");
    expect(countRequests(http, FORGE_INSTALLER_URL)).toBe(1);
  });

  // Corruption past `install_profile.json` is invisible to the reuse gate, so without a retry the
  // cached JAR wedges every future plan / repair / repair-from-error at the same entry.
  it("re-downloads an installer whose maven member is unreadable", async () => {
    const http = createForgeHttp();
    await fs.mkdir(path.dirname(installerPath), { recursive: true });
    await fs.writeFile(installerPath, installerWithUnreadableMavenEntry());

    const result = await plan(http);
    expect(result.versionId).toBe(FORGE_FULL_VERSION);
    expect(countRequests(http, FORGE_INSTALLER_URL)).toBe(1);
    expect(await fs.readFile(mavenArtifact, "utf8")).toBe("forge-jar");
  });

  it("does not retry the installer download for a failure a fresh JAR cannot fix", async () => {
    // An unknown processor token is a bad *manifest*, not a bad download, and it is raised after
    // the archive phase: the retry must not spend a second fetch on it.
    const brokenHttp = createForgeHttp(
      installerBytesWithProfile({
        spec: 1,
        profile: "forge",
        version: FORGE_FULL_VERSION,
        minecraft: "1.20.1",
        json: "/version.json",
        data: {},
        libraries: [],
        processors: [
          { jar: "net.minecraftforge:jarsplitter:1.0", args: ["{OOPS}"], classpath: [] },
        ],
      }),
    );

    await expect(plan(brokenHttp)).rejects.toMatchObject({
      code: MinecraftKitErrorCodes.FORGE_INSTALLER_INVALID,
    });
    expect(countRequests(brokenHttp, FORGE_INSTALLER_URL)).toBe(1);
  });
});

describe("planInstall — Forge actions", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-forge-planner-"));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("never emits the installer JAR as a download action", async () => {
    const http = createForgeHttp();
    const installPlan = await planInstall({
      target: buildForgeTarget(directory),
      http,
      cache: createMemoryCache(),
    });

    const downloads = installPlan.actions.filter(
      (action) => action.kind === InstallActionKinds.DOWNLOAD_FILE,
    );
    expect(downloads.length).toBeGreaterThan(0);
    expect(
      downloads.some(
        (action) =>
          action.kind === InstallActionKinds.DOWNLOAD_FILE &&
          action.category === DownloadCategories.FORGE_INSTALLER,
      ),
    ).toBe(false);
    expect(
      downloads.some(
        (action) =>
          action.kind === InstallActionKinds.DOWNLOAD_FILE && action.url === FORGE_INSTALLER_URL,
      ),
    ).toBe(false);
  });
});
