import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { targetPaths } from "../../src/core/paths";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { createMemoryCache } from "../../src/http/cache";
import { repairAll } from "../../src/repair/all";
import { EventTypes, type ProgressEvent } from "../../src/types/events";
import { Loaders } from "../../src/types/loader";
import type { Target } from "../../src/types/target";
import { VerificationKinds, VerifyFileCategories } from "../../src/types/verify";
import { FakeHttpClient } from "../helpers/fake-http";
import { FakeSpawner } from "../helpers/fake-spawner";
import { sha1OfBytes } from "../helpers/hash";

const textSize = (value: string): number => new TextEncoder().encode(value).byteLength;

const buildRepairTarget = (directory: string): Target => {
  const version = asMinecraftVersionId("1.20.1");
  const clientBody = "client";
  const assetIndexBody = '{"objects":{}}';
  const minecraft: Target["minecraft"] = {
    version,
    channel: "release",
    manifest: {
      id: version,
      type: "release",
      mainClass: "net.minecraft.client.main.Main",
      assetIndex: {
        id: "5",
        sha1: sha1OfBytes(assetIndexBody),
        size: textSize(assetIndexBody),
        totalSize: textSize(assetIndexBody),
        url: "https://idx/",
      },
      assets: "5",
      downloads: {
        client: {
          sha1: sha1OfBytes(clientBody),
          size: textSize(clientBody),
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
  return {
    id: "repair-all",
    directory,
    minecraft,
    loader: { type: Loaders.VANILLA, minecraftVersion: version, minecraft },
    runtime: {
      component: "java-runtime-gamma",
      platformKey: "windows-x64",
      versionName: "17.0.8",
      majorVersion: 17,
      system: { os: "windows", arch: "x64", osVersion: "10.0" },
      manifestUrl: "https://runtime-manifest/",
      manifestSha1: "runtime-manifest-sha1",
    },
  };
};

describe("repairAll progress events", () => {
  it("forwards verification events and annotates repair events with their aspect", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mckit-repair-all-"));
    try {
      const target = buildRepairTarget(root);
      const assetIndexBody = '{"objects":{}}';
      const runtimeBody = "java";
      const runtimeManifest = {
        files: {
          "bin/javaw.exe": {
            type: "file",
            executable: true,
            downloads: {
              raw: {
                sha1: sha1OfBytes(runtimeBody),
                size: textSize(runtimeBody),
                url: "https://runtime/javaw",
              },
            },
          },
        },
      };
      await mkdir(path.dirname(targetPaths.assetIndex(root, "5")), { recursive: true });
      await writeFile(targetPaths.assetIndex(root, "5"), assetIndexBody);

      const http = new FakeHttpClient()
        .on("https://idx/", { body: assetIndexBody })
        .on("https://client/", { body: "client" })
        .on("https://runtime-manifest/", { body: JSON.stringify(runtimeManifest) })
        .on("https://runtime/javaw", { body: runtimeBody });
      const events: ProgressEvent[] = [];

      const report = await repairAll({
        target,
        http,
        cache: createMemoryCache(),
        spawner: new FakeSpawner(),
        onEvent: (event) => events.push(event),
      });

      const runtimePath = path.join(root, "runtime", "java-runtime-gamma", "bin", "javaw.exe");
      expect([...report.repairs.keys()]).toEqual([
        VerificationKinds.MINECRAFT,
        VerificationKinds.RUNTIME,
      ]);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: EventTypes.VERIFY_FILE_CHECKED,
            aspect: VerificationKinds.MINECRAFT,
            file: expect.objectContaining({ category: VerifyFileCategories.CLIENT_JAR }),
          }),
          expect.objectContaining({
            type: EventTypes.VERIFY_FILE_CHECKED,
            aspect: VerificationKinds.RUNTIME,
            file: expect.objectContaining({ category: VerifyFileCategories.RUNTIME_FILE }),
          }),
          expect.objectContaining({
            type: EventTypes.DOWNLOAD_STARTED,
            aspect: VerificationKinds.MINECRAFT,
            file: expect.objectContaining({ target: targetPaths.versionJar(root, "1.20.1") }),
          }),
          expect.objectContaining({
            type: EventTypes.DOWNLOAD_STARTED,
            aspect: VerificationKinds.RUNTIME,
            file: expect.objectContaining({ target: runtimePath }),
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
