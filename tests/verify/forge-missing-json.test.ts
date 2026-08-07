import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { targetPaths } from "../../src/core/paths";
import { createMemoryCache } from "../../src/http/cache";
import type { Target } from "../../src/types/target";
import { VerifyFileCategories, VerifyFileStatuses } from "../../src/types/verify";
import { verifyForge } from "../../src/verify/forge";
import { FakeHttpClient } from "../helpers/fake-http";
import { buildForgeTarget, FORGE_FULL_VERSION, forgeLoader } from "../helpers/forge-fixture";

// verify.forge stays offline for these cases: it never reaches a manifest fetch, so an
// unmocked client is the strongest assertion that nothing tries.
const offline = () => ({ http: new FakeHttpClient(), cache: createMemoryCache() });

const withRoot = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-verify-forge-"));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
};

describe("verifyForge with no usable version JSON", () => {
  it("reports the expected fullVersion path when versions/ holds no Forge directory", async () => {
    await withRoot(async (root) => {
      await fs.mkdir(path.join(targetPaths.versionsDir(root), "1.20.1"), { recursive: true });

      const result = await verifyForge({ target: buildForgeTarget(root), ...offline() });

      expect(result.isValid).toBe(false);
      expect(result.issues).toEqual([
        {
          path: targetPaths.versionJson(root, FORGE_FULL_VERSION),
          category: VerifyFileCategories.LOADER_LIBRARY,
          status: VerifyFileStatuses.MISSING,
        },
      ]);
    });
  });

  // A Forge version *directory* with no JSON inside it is what a half-finished install leaves
  // behind. Verification must stop at the missing JSON rather than try to enumerate libraries
  // from a file that is not there.
  it("stops at the missing JSON when the Forge version directory exists but is empty", async () => {
    await withRoot(async (root) => {
      const jsonPath = targetPaths.versionJson(root, FORGE_FULL_VERSION);
      await fs.mkdir(path.dirname(jsonPath), { recursive: true });

      const result = await verifyForge({ target: buildForgeTarget(root), ...offline() });

      expect(result.issues).toEqual([
        {
          path: jsonPath,
          category: VerifyFileCategories.LOADER_LIBRARY,
          status: VerifyFileStatuses.MISSING,
        },
      ]);
      expect(result.checkedFiles).toBe(1);
    });
  });

  // `loader.fullVersion` is the Maven version (`1.20.1-47.2.0`), not the version id Forge's
  // installer writes (`1.20.1-forge-47.2.0`). Reporting the Maven-shaped path made the issue
  // unmatchable against the install plan's WRITE_VERSION_JSON action, so repair silently skipped
  // rewriting the one file it was asked to restore.
  it("reports the version id the install plan writes, not the Maven full version", async () => {
    await withRoot(async (root) => {
      const target: Target = {
        ...buildForgeTarget(root),
        loader: { ...forgeLoader(), fullVersion: "1.20.1-47.2.0" },
      };
      await fs.mkdir(path.join(targetPaths.versionsDir(root), "1.20.1"), { recursive: true });

      const result = await verifyForge({ target, ...offline() });

      expect(result.issues.map((issue) => issue.path)).toEqual([
        targetPaths.versionJson(root, FORGE_FULL_VERSION),
      ]);
    });
  });

  // `findForgeVersionJsonPath` only returns a directory whose JSON declares the target's
  // Minecraft version, so a Forge tree left over from another Minecraft version is not adopted.
  it("ignores a Forge directory whose JSON inherits from another Minecraft version", async () => {
    await withRoot(async (root) => {
      const strayId = "1.20.1-forge-47.9.9";
      const strayJson = targetPaths.versionJson(root, strayId);
      await fs.mkdir(path.dirname(strayJson), { recursive: true });
      await fs.writeFile(strayJson, JSON.stringify({ id: strayId, inheritsFrom: "1.19.4" }));

      const result = await verifyForge({ target: buildForgeTarget(root), ...offline() });

      expect(result.issues.map((issue) => issue.path)).toEqual([
        targetPaths.versionJson(root, FORGE_FULL_VERSION),
      ]);
    });
  });
});
