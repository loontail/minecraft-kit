import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VERIFY_CONCURRENCY } from "../../src/constants/defaults";
import { targetPaths } from "../../src/core/paths";
import { asMinecraftVersionId } from "../../src/core/version-id";
import { createMemoryCache } from "../../src/http/cache";
import { EventTypes } from "../../src/types/events";
import { Loaders } from "../../src/types/loader";
import type { Target } from "../../src/types/target";
import { VerifyFileCategories, VerifyFileStatuses } from "../../src/types/verify";
import { verifyMinecraft } from "../../src/verify/minecraft";
import { FakeHttpClient } from "../helpers/fake-http";
import { sha1OfBytes } from "../helpers/hash";

const { hashProbe } = vi.hoisted(() => ({
  hashProbe: { inFlight: 0, maxInFlight: 0, calls: 0 },
}));

vi.mock("../../src/core/hash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/hash")>();
  return {
    ...actual,
    sha1OfFile: async (filePath: string): Promise<string> => {
      hashProbe.calls++;
      hashProbe.inFlight++;
      hashProbe.maxInFlight = Math.max(hashProbe.maxInFlight, hashProbe.inFlight);
      // A real event-loop turn, so concurrent tasks are observably overlapping rather than
      // finishing inside the same microtask queue drain.
      await new Promise((resolve) => setImmediate(resolve));
      try {
        return await actual.sha1OfFile(filePath);
      } finally {
        hashProbe.inFlight--;
      }
    },
  };
});

const ASSET_COUNT = 24;
const CORRUPTED_INDEXES = new Set([3, 11, 20]);

type AssetFixture = { readonly hash: string; readonly size: number; readonly body: string };

const assetFixtures = (): readonly AssetFixture[] =>
  Array.from({ length: ASSET_COUNT }, (_unused, index) => {
    const body = `asset-object-${index}`;
    return { hash: sha1OfBytes(body), size: new TextEncoder().encode(body).byteLength, body };
  });

const CLIENT_BODY = "client";

const buildTarget = (directory: string, indexBody: string): Target => {
  const version = asMinecraftVersionId("1.20.1");
  const minecraft: Target["minecraft"] = {
    version,
    channel: "release",
    manifest: {
      id: version,
      type: "release",
      mainClass: "net.minecraft.client.main.Main",
      assetIndex: {
        id: "5",
        sha1: sha1OfBytes(indexBody),
        size: new TextEncoder().encode(indexBody).byteLength,
        totalSize: 1,
        url: "https://idx/",
      },
      assets: "5",
      downloads: {
        client: {
          sha1: sha1OfBytes(CLIENT_BODY),
          size: new TextEncoder().encode(CLIENT_BODY).byteLength,
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
      time: "t",
      releaseTime: "r",
      sha1: "x",
      complianceLevel: 1,
    },
  };
  return {
    id: "pooled",
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
      manifestSha1: "x",
    },
  };
};

// KIT-P9: verification used to SHA-1 every asset object strictly one at a time, so a cold-cache
// verify of a real install (~4,000 objects) was dominated by per-file open latency.
describe("verifyMinecraft — pooled asset hashing", () => {
  let directory: string;
  let fixtures: readonly AssetFixture[];
  let indexBody: string;

  beforeEach(async () => {
    hashProbe.inFlight = 0;
    hashProbe.maxInFlight = 0;
    hashProbe.calls = 0;
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-pooled-"));
    fixtures = assetFixtures();
    indexBody = JSON.stringify({
      objects: Object.fromEntries(
        fixtures.map((fixture, index) => [
          `virtual/path/${index}`,
          { hash: fixture.hash, size: fixture.size },
        ]),
      ),
    });

    const clientJar = targetPaths.versionJar(directory, "1.20.1");
    await fs.mkdir(path.dirname(clientJar), { recursive: true });
    await fs.writeFile(clientJar, CLIENT_BODY);
    await fs.writeFile(targetPaths.versionJson(directory, "1.20.1"), "{}");
    const indexPath = targetPaths.assetIndex(directory, "5");
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.writeFile(indexPath, indexBody);
    await fs.mkdir(targetPaths.nativesDir(directory, "1.20.1"), { recursive: true });

    for (const [index, fixture] of fixtures.entries()) {
      const objectPath = targetPaths.assetObject(directory, fixture.hash);
      await fs.mkdir(path.dirname(objectPath), { recursive: true });
      // Same byte length, different content — so the size short-circuit cannot fire and every
      // object really is hashed.
      await fs.writeFile(
        objectPath,
        CORRUPTED_INDEXES.has(index) ? fixture.body.toUpperCase() : fixture.body,
      );
    }
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  const run = () =>
    verifyMinecraft({
      target: buildTarget(directory, indexBody),
      http: new FakeHttpClient().on("https://idx/", { body: indexBody }),
      cache: createMemoryCache(),
    });

  it("hashes asset objects concurrently, bounded by VERIFY_CONCURRENCY", async () => {
    await run();
    expect(hashProbe.calls).toBeGreaterThanOrEqual(ASSET_COUNT);
    expect(hashProbe.maxInFlight).toBeGreaterThan(1);
    expect(hashProbe.maxInFlight).toBeLessThanOrEqual(VERIFY_CONCURRENCY);
  });

  // KIT-P9 follow-up: recording only after the whole pool drained turned the asset bucket into
  // multi-second silence followed by one burst of thousands of listener calls on a single tick.
  it("emits file-checked events while the pool is still hashing", async () => {
    const hashCallsPerEvent: number[] = [];
    await verifyMinecraft({
      target: buildTarget(directory, indexBody),
      http: new FakeHttpClient().on("https://idx/", { body: indexBody }),
      cache: createMemoryCache(),
      onEvent: (event) => {
        if (
          event.type === EventTypes.VERIFY_FILE_CHECKED &&
          event.file.category === VerifyFileCategories.ASSET
        ) {
          hashCallsPerEvent.push(hashProbe.calls);
        }
      },
    });

    expect(hashCallsPerEvent.length).toBe(ASSET_COUNT);
    // The first asset result is reported once its own hash lands — not after all of them have.
    expect(hashCallsPerEvent[0]).toBeLessThan(ASSET_COUNT);
  });

  it("records results in asset-index order regardless of completion order", async () => {
    const result = await run();
    const corruptPaths = result.issues
      .filter((issue) => issue.category === VerifyFileCategories.ASSET)
      .map((issue) => issue.path);

    expect(result.issues.every((issue) => issue.status === VerifyFileStatuses.CORRUPT)).toBe(true);
    expect(corruptPaths).toEqual(
      [...CORRUPTED_INDEXES]
        .sort((a, b) => a - b)
        .map((index) => targetPaths.assetObject(directory, fixtures[index]?.hash ?? "")),
    );
    // client jar + vanilla version JSON + asset index, plus every asset object.
    expect(result.checkedFiles).toBe(ASSET_COUNT + 3);
  });
});
