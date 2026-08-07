import path from "node:path";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { Loaders } from "../../src/types/loader";
import type { ResolvedMinecraft } from "../../src/types/minecraft";
import type { RuntimeSystem } from "../../src/types/system";
import type { Target } from "../../src/types/target";
import { FakeHttpClient } from "./fake-http";
import { sha1OfBytes } from "./hash";
import { fixtureZipBytes } from "./zip";

export const FORGE_INSTALLER_URL = "https://forge/installer.jar";
export const FORGE_FULL_VERSION = "1.20.1-forge-47.2.0";
export const FORGE_LIBRARY_URL = "https://forge/lib/forge-extra.jar";
export const FORGE_MAVEN_ENTRY_RELATIVE = path.join(
  "net",
  "minecraftforge",
  "forge",
  "47.2.0",
  "forge-47.2.0.jar",
);

export const ASSET_INDEX_BODY = '{"objects":{}}';
export const CLIENT_BODY = "client";
export const RUNTIME_FILE_BODY = "java";
export const FORGE_LIBRARY_BODY = "forge-extra";

const textSize = (value: string): number => new TextEncoder().encode(value).byteLength;

const INSTALL_PROFILE = {
  spec: 1,
  profile: "forge",
  version: FORGE_FULL_VERSION,
  minecraft: "1.20.1",
  json: "/version.json",
  data: {},
  libraries: [],
  processors: [],
};

const FORGE_VERSION_JSON = {
  id: FORGE_FULL_VERSION,
  inheritsFrom: "1.20.1",
  type: "release",
  mainClass: "cpw.mods.bootstraplauncher.BootstrapLauncher",
  libraries: [
    {
      name: "net.minecraftforge:forge-extra:47.2.0",
      downloads: {
        artifact: {
          path: "net/minecraftforge/forge-extra/47.2.0/forge-extra-47.2.0.jar",
          url: FORGE_LIBRARY_URL,
          sha1: sha1OfBytes(FORGE_LIBRARY_BODY),
          size: textSize(FORGE_LIBRARY_BODY),
        },
      },
    },
  ],
};

export const FORGE_MAVEN_ENTRY_NAME = "maven/net/minecraftforge/forge/47.2.0/forge-47.2.0.jar";

export const FORGE_PATCHED_RELATIVE = path.join(
  "net",
  "minecraftforge",
  "forge",
  "47.2.0",
  "forge-47.2.0-client.jar",
);
export const FORGE_PATCHED_BODY = "patched-client";

/**
 * `install_profile.json` with one client processor whose declared output is the patched client JAR
 * — a generated artifact with a published SHA-1 that nothing downloads.
 */
const PROCESSOR_INSTALL_PROFILE = {
  ...INSTALL_PROFILE,
  data: {
    PATCHED: { client: "[net.minecraftforge:forge:47.2.0:client]", server: "" },
    PATCHED_SHA: { client: `'${sha1OfBytes(FORGE_PATCHED_BODY)}'`, server: "" },
  },
  processors: [
    {
      sides: ["client"],
      jar: "net.minecraftforge:installertools:1.3.0",
      classpath: [],
      args: ["--task", "BUNDLER_EXTRACT", "--output", "{PATCHED}"],
      outputs: { "{PATCHED}": "{PATCHED_SHA}" },
    },
  ],
};

/** Installer JAR whose profile declares one processor with a hashed output. */
export const forgeInstallerWithProcessorBytes = (): Buffer =>
  installerBytesWithProfile(PROCESSOR_INSTALL_PROFILE);

/** Installer JAR carrying a 1.7.x-era `install_profile.json`: no `data`, no processors. */
export const legacyForgeInstallerBytes = (): Buffer =>
  installerBytesWithProfile({
    install: {
      target: FORGE_FULL_VERSION,
      path: "net.minecraftforge:forge:47.2.0",
      filePath: "forge-47.2.0-universal.jar",
      minecraft: "1.20.1",
    },
    versionInfo: FORGE_VERSION_JSON,
  });

/**
 * Bytes of a minimal-but-real Forge installer JAR: `install_profile.json` (spec 1),
 * `version.json`, and one `maven/` entry so the embedded-artifact flush has something to do.
 */
export const forgeInstallerBytes = (mavenContent = "forge-jar"): Buffer =>
  installerBytesWithProfile(INSTALL_PROFILE, mavenContent);

/** Same JAR as {@link forgeInstallerBytes} with a caller-supplied `install_profile.json`. */
export const installerBytesWithProfile = (profile: unknown, mavenContent = "forge-jar"): Buffer =>
  fixtureZipBytes([
    { name: "install_profile.json", content: JSON.stringify(profile) },
    { name: "version.json", content: JSON.stringify(FORGE_VERSION_JSON) },
    { name: FORGE_MAVEN_ENTRY_NAME, content: mavenContent },
  ]);

/** Length of a zip local file header before the entry name. */
const LOCAL_HEADER_LENGTH = 30;

/**
 * Installer JAR whose central directory and `install_profile.json` stay readable while the
 * `maven/` member's local file header is corrupt — what a bad sector leaves behind, and the case
 * an `install_profile.json`-only reuse gate cannot see.
 */
export const installerWithUnreadableMavenEntry = (): Buffer => {
  const bytes = Buffer.from(forgeInstallerBytes());
  const nameOffset = bytes.indexOf(Buffer.from(FORGE_MAVEN_ENTRY_NAME, "utf8"));
  bytes[nameOffset - LOCAL_HEADER_LENGTH] = 0;
  return bytes;
};

export const FORGE_SYSTEM: RuntimeSystem = { os: "windows", arch: "x64", osVersion: "10.0" };

export const forgeMinecraft = (): ResolvedMinecraft => {
  const version = asMinecraftVersionId("1.20.1");
  return {
    version,
    channel: "release",
    manifest: {
      id: version,
      type: "release",
      mainClass: "net.minecraft.client.main.Main",
      assetIndex: {
        id: "5",
        sha1: sha1OfBytes(ASSET_INDEX_BODY),
        size: textSize(ASSET_INDEX_BODY),
        totalSize: textSize(ASSET_INDEX_BODY),
        url: "https://idx/",
      },
      assets: "5",
      downloads: {
        client: {
          sha1: sha1OfBytes(CLIENT_BODY),
          size: textSize(CLIENT_BODY),
          url: "https://client/",
        },
      },
      libraries: [],
      javaVersion: { component: "java-runtime-gamma", majorVersion: 17 },
    },
    summary: {
      id: version,
      type: "release",
      url: "https://version/",
      time: "2024-01-01T00:00:00+00:00",
      releaseTime: "2024-01-01T00:00:00+00:00",
      sha1: "version-sha1",
      complianceLevel: 1,
    },
  };
};

export const forgeLoader = () =>
  ({
    type: Loaders.FORGE,
    minecraftVersion: "1.20.1",
    forgeVersion: "47.2.0",
    fullVersion: FORGE_FULL_VERSION,
    installerUrl: FORGE_INSTALLER_URL,
  }) as const;

export const buildForgeTarget = (directory: string): Target => ({
  id: "forge-target",
  directory,
  minecraft: forgeMinecraft(),
  loader: forgeLoader(),
  runtime: {
    component: "java-runtime-gamma",
    platformKey: "windows-x64",
    versionName: "17.0.8",
    majorVersion: 17,
    system: FORGE_SYSTEM,
    manifestUrl: "https://runtime-manifest/",
    manifestSha1: "runtime-manifest-sha1",
  },
});

/** HTTP client serving everything a full Forge plan + run needs. */
export const createForgeHttp = (installerBytes = forgeInstallerBytes()): FakeHttpClient => {
  const runtimeManifest = {
    files: {
      "bin/javaw.exe": {
        type: "file",
        executable: true,
        downloads: {
          raw: {
            sha1: sha1OfBytes(RUNTIME_FILE_BODY),
            size: textSize(RUNTIME_FILE_BODY),
            url: "https://runtime/javaw",
          },
        },
      },
    },
  };
  return new FakeHttpClient()
    .on("https://idx/", { body: ASSET_INDEX_BODY })
    .on("https://client/", { body: CLIENT_BODY })
    .on("https://runtime-manifest/", { body: JSON.stringify(runtimeManifest) })
    .on("https://runtime/javaw", { body: RUNTIME_FILE_BODY })
    .on(FORGE_LIBRARY_URL, { body: FORGE_LIBRARY_BODY })
    .on(FORGE_INSTALLER_URL, { body: new Uint8Array(installerBytes) });
};

export const countRequests = (http: FakeHttpClient, url: string): number =>
  http.requests.filter((request) => request.url === url).length;
