import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MinecraftKitErrorCodes } from "../../src/core/errors";
import { targetPaths } from "../../src/core/paths";
import {
  extractInstallerMavenEntries,
  extractLegacyForgeUniversalJar,
} from "../../src/install/forge-installer-archive";
import { resolveProfileData } from "../../src/install/forge-processor-plan";
import type { ForgeInstallProfile, LegacyForgeInstallProfile } from "../../src/types/forge";
import { writeFixtureZip } from "../helpers/zip";

const expectCode = async (run: () => Promise<unknown>, code: string): Promise<void> => {
  await expect(run()).rejects.toMatchObject({ code });
};

const legacyProfile = (installPath: string): LegacyForgeInstallProfile => ({
  install: {
    profileName: "Forge",
    target: "1.7.10-Forge",
    path: installPath,
    version: "Forge 10.13.4.1614",
    filePath: "forge-universal.jar",
    minecraft: "1.7.10",
  },
  versionInfo: {
    id: "1.7.10-Forge",
    inheritsFrom: "1.7.10",
    type: "release",
    mainClass: "net.minecraft.launchwrapper.Launch",
    libraries: [{ name: installPath }],
  },
});

const profileWithDataValue = (value: string): ForgeInstallProfile => ({
  spec: 1,
  profile: "forge",
  version: "1.20.1-forge-47.2.0",
  minecraft: "1.20.1",
  json: "/version.json",
  data: { EVIL: { client: value, server: value } },
  libraries: [],
  processors: [],
});

describe("Forge extraction containment", () => {
  let tmpDir: string;
  let directory: string;
  let installerPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-forge-containment-"));
    directory = path.join(tmpDir, "client");
    installerPath = path.join(tmpDir, "installer.jar");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("extractInstallerMavenEntries", () => {
    it("extracts well-named maven entries under libraries/", async () => {
      await writeFixtureZip(installerPath, [
        { name: "maven/com/example/lib/1.0/lib-1.0.jar", content: "jar-bytes" },
        { name: "install_profile.json", content: "{}" },
      ]);

      await extractInstallerMavenEntries(installerPath, directory);

      const written = path.join(
        targetPaths.librariesDir(directory),
        "com",
        "example",
        "lib",
        "1.0",
        "lib-1.0.jar",
      );
      expect(await fs.readFile(written, "utf8")).toBe("jar-bytes");
    });

    it("rejects an entry whose name is a reserved Windows device name", async () => {
      await writeFixtureZip(installerPath, [{ name: "maven/CON.txt", content: "x" }]);

      await expectCode(
        () => extractInstallerMavenEntries(installerPath, directory),
        MinecraftKitErrorCodes.ARCHIVE_ENTRY_REJECTED,
      );
    });

    it("rejects an entry name with a trailing dot", async () => {
      await writeFixtureZip(installerPath, [{ name: "maven/a/evil.", content: "x" }]);

      await expectCode(
        () => extractInstallerMavenEntries(installerPath, directory),
        MinecraftKitErrorCodes.ARCHIVE_ENTRY_REJECTED,
      );
      await expect(
        fs.access(path.join(targetPaths.librariesDir(directory), "a")),
      ).rejects.toBeTruthy();
    });
  });

  describe("extractLegacyForgeUniversalJar", () => {
    beforeEach(async () => {
      await writeFixtureZip(installerPath, [
        { name: "forge-universal.jar", content: "universal-bytes" },
      ]);
    });

    it("extracts to the maven path under libraries/", async () => {
      const destination = await extractLegacyForgeUniversalJar(
        installerPath,
        legacyProfile("net.minecraftforge:forge:1.7.10-10.13.4.1614"),
        directory,
      );

      expect(destination.startsWith(targetPaths.librariesDir(directory))).toBe(true);
      expect(await fs.readFile(destination, "utf8")).toBe("universal-bytes");
    });

    // The `@extension` component of a Maven coordinate is an arbitrary string taken straight
    // from install_profile.json, and it lands in the filename — so it is a traversal vector.
    it("rejects an install.path whose extension escapes libraries/", async () => {
      await expectCode(
        () =>
          extractLegacyForgeUniversalJar(
            installerPath,
            legacyProfile("a:b:c@../../../../evil.bat"),
            directory,
          ),
        MinecraftKitErrorCodes.ARCHIVE_ENTRY_REJECTED,
      );
      await expect(fs.access(path.join(tmpDir, "..", "evil.bat"))).rejects.toBeTruthy();
    });

    it("rejects an install.path whose group escapes libraries/", async () => {
      await expectCode(
        () => extractLegacyForgeUniversalJar(installerPath, legacyProfile("..:b:c"), directory),
        MinecraftKitErrorCodes.ARCHIVE_ENTRY_REJECTED,
      );
    });
  });

  describe("resolveProfileData extract tokens", () => {
    beforeEach(async () => {
      await writeFixtureZip(installerPath, [{ name: "data/client.lzma", content: "lzma" }]);
    });

    it("extracts a well-named entry under libraries/forge-data", async () => {
      const resolved = await resolveProfileData({
        profile: profileWithDataValue("/data/client.lzma"),
        installerPath,
        directory,
      });

      const expected = path.join(
        targetPaths.librariesDir(directory),
        "forge-data",
        "data",
        "client.lzma",
      );
      expect(resolved.tokens.EVIL?.value).toBe(expected);
      expect(await fs.readFile(expected, "utf8")).toBe("lzma");
    });

    it("rejects an extract token that escapes libraries/forge-data", async () => {
      await expectCode(
        () =>
          resolveProfileData({
            profile: profileWithDataValue("/../../escape.txt"),
            installerPath,
            directory,
          }),
        MinecraftKitErrorCodes.ARCHIVE_ENTRY_REJECTED,
      );
      await expect(fs.access(path.join(tmpDir, "escape.txt"))).rejects.toBeTruthy();
    });
  });
});
