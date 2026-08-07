import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryCache } from "../../src/http/cache";
import { repairAll } from "../../src/repair/all";
import { VerificationKinds } from "../../src/types/verify";
import { FakeSpawner } from "../helpers/fake-spawner";
import {
  buildForgeTarget,
  countRequests,
  createForgeHttp,
  FORGE_INSTALLER_URL,
} from "../helpers/forge-fixture";

const { planCounter } = vi.hoisted(() => ({ planCounter: { count: 0 } }));

vi.mock("../../src/install/planner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/install/planner")>();
  return {
    ...actual,
    planInstall: (input: Parameters<typeof actual.planInstall>[0]) => {
      planCounter.count++;
      return actual.planInstall(input);
    },
  };
});

// KIT-P4: every aspect planner filters the *same* full install plan, so `repairAll` must build
// it once. Before the fix each broken aspect built its own — three `planInstall` calls for a
// broken Forge target, each one re-reading the installer archive and re-resolving the asset
// index, and (before KIT-P3) re-downloading the installer and re-extracting `maven/**`.
describe("repairAll — one install plan per run", () => {
  beforeEach(() => {
    planCounter.count = 0;
  });

  it("builds the install plan exactly once for a Forge target with three broken aspects", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mckit-shared-plan-"));
    try {
      const http = createForgeHttp();
      const report = await repairAll({
        target: buildForgeTarget(root),
        http,
        cache: createMemoryCache(),
        spawner: new FakeSpawner(),
      });

      expect([...report.repairs.keys()].sort()).toEqual(
        [VerificationKinds.FORGE, VerificationKinds.MINECRAFT, VerificationKinds.RUNTIME].sort(),
      );
      expect(planCounter.count).toBe(1);
      expect(countRequests(http, FORGE_INSTALLER_URL)).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not plan at all when every aspect verifies clean", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mckit-shared-plan-clean-"));
    try {
      const http = createForgeHttp();
      // First pass repairs everything; second pass should find nothing to do and never plan.
      await repairAll({
        target: buildForgeTarget(root),
        http,
        cache: createMemoryCache(),
        spawner: new FakeSpawner(),
      });
      planCounter.count = 0;

      const report = await repairAll({
        target: buildForgeTarget(root),
        http,
        cache: createMemoryCache(),
        spawner: new FakeSpawner(),
      });

      expect(report.repairs.size).toBe(0);
      expect(report.installPlan).toBeNull();
      expect(planCounter.count).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
