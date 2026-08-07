import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { targetPaths } from "../../src/core/paths";
import {
  ForgeProcessorOutputScanKinds,
  listForgeProcessorOutputs,
} from "../../src/install/forge-processor-outputs";
import {
  FORGE_FULL_VERSION,
  forgeLoader,
  forgeMinecraft,
  installerBytesWithProfile,
} from "../helpers/forge-fixture";

const PUBLISHED_SHA1 = "a".repeat(40);

/**
 * A profile where two processors write the SAME output path: the first publishes a digest, the
 * second declares the path with an empty hash (the shape a `{..._SHA}` token takes when it
 * resolves to nothing). `order` decides which one the profile lists first.
 */
const duplicateOutputInstallerBytes = (order: "hash-first" | "hashless-first"): Buffer => {
  const withHash = {
    sides: ["client"],
    jar: "net.minecraftforge:installertools:1.3.0",
    classpath: [],
    args: ["--task", "BUNDLER_EXTRACT", "--output", "{PATCHED}"],
    outputs: { "{PATCHED}": PUBLISHED_SHA1 },
  };
  const withoutHash = { ...withHash, outputs: { "{PATCHED}": "" } };
  return installerBytesWithProfile({
    spec: 1,
    profile: "forge",
    version: FORGE_FULL_VERSION,
    minecraft: "1.20.1",
    json: "/version.json",
    data: { PATCHED: { client: "[net.minecraftforge:forge:47.2.0:client]", server: "" } },
    libraries: [],
    processors: order === "hash-first" ? [withHash, withoutHash] : [withoutHash, withHash],
  });
};

// Regression: the de-duplication was last-write-wins, so a later hashless declaration erased a
// digest an earlier processor had published — silently downgrading that file from "verify the
// contents" to "check it exists", the same fail-open this scan was fixed to stop doing. Which
// processor the profile happens to list first must not decide whether the file is really verified.
describe("listForgeProcessorOutputs — one output path declared twice", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-forge-dup-"));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  const scanWith = async (order: "hash-first" | "hashless-first") => {
    const installerPath = targetPaths.forgeInstaller(directory, forgeLoader().fullVersion);
    await fs.mkdir(path.dirname(installerPath), { recursive: true });
    await fs.writeFile(installerPath, duplicateOutputInstallerBytes(order));
    return listForgeProcessorOutputs({
      directory,
      loader: forgeLoader(),
      minecraft: forgeMinecraft(),
    });
  };

  it.each(["hash-first", "hashless-first"] as const)(
    "keeps the published digest when the profile lists %s",
    async (order) => {
      const scan = await scanWith(order);

      expect(scan.kind).toBe(ForgeProcessorOutputScanKinds.DECLARED);
      if (scan.kind !== ForgeProcessorOutputScanKinds.DECLARED) return;
      expect(scan.outputs).toHaveLength(1);
      expect(scan.outputs[0]?.sha1).toBe(PUBLISHED_SHA1);
    },
  );
});
