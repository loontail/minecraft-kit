import { describe, expect, it } from "vitest";
import type { AuthRef } from "../../src/cli/scenarios";
import { scenarioRepair, scenarioVerify } from "../../src/cli/scenarios/verify-repair";
import { createStubUi, type StubUi } from "../../src/cli/ui";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../../src/core/errors";
import type { MinecraftKit } from "../../src/kit";
import { AuthModes } from "../../src/types/auth";
import { Loaders } from "../../src/types/loader";
import type { RepairPlan, RepairReport } from "../../src/types/repair";
import type { DiscoveredTarget, Target } from "../../src/types/target";
import {
  VerificationKinds,
  type VerificationResult,
  VerifyFileCategories,
  VerifyFileStatuses,
} from "../../src/types/verify";
import { fakeTarget } from "../helpers/fake-kit";

const ROOT_DIR = "/tmp/mckit-verify-repair";

const auth = (): AuthRef => ({
  state: { kind: "offline", auth: { mode: AuthModes.OFFLINE, username: "Player" } },
});

const discovered = (overrides: Partial<DiscoveredTarget> = {}): readonly DiscoveredTarget[] => [
  {
    id: "demo",
    directory: "/tmp/demo",
    minecraftVersions: ["1.20.1"],
    loaders: [],
    ...overrides,
  },
];

const clean = (kind: VerificationResult["kind"]): VerificationResult => ({
  targetId: "demo",
  kind,
  isValid: true,
  issues: [],
  checkedFiles: 3,
  durationMs: 1,
});

const broken = (kind: VerificationResult["kind"], count: number): VerificationResult => ({
  targetId: "demo",
  kind,
  isValid: false,
  issues: Array.from({ length: count }, (_, index) => ({
    path: `/tmp/demo/broken-${kind}-${index}`,
    category: VerifyFileCategories.LIBRARY,
    status: VerifyFileStatuses.MISSING,
  })),
  checkedFiles: 3,
  durationMs: 1,
});

type KitInput = {
  readonly listResult?: readonly DiscoveredTarget[];
  readonly listError?: unknown;
  readonly resolveError?: unknown;
  readonly target?: Target;
  readonly verifications?: Partial<Record<VerificationResult["kind"], VerificationResult>>;
  readonly verifyError?: unknown;
  readonly planActions?: number;
  readonly repairError?: unknown;
};

type Recorder = {
  readonly verified: string[];
  readonly planned: string[];
  readonly ran: string[];
};

const buildKit = (input: KitInput = {}): { kit: MinecraftKit; recorder: Recorder } => {
  const recorder: Recorder = { verified: [], planned: [], ran: [] };
  const target = input.target ?? fakeTarget;
  const plan = (): RepairPlan => ({
    targetId: target.id,
    directory: target.directory,
    target,
    actions: [],
    totalActions: input.planActions ?? 1,
    totalBytes: 0,
  });
  const report: RepairReport = {
    targetId: target.id,
    bytesDownloaded: 0,
    actionsCompleted: input.planActions ?? 1,
    actionsSkipped: 0,
    durationMs: 1,
  };
  const verifyAspect = (kind: VerificationResult["kind"]) => ({
    run: async (): Promise<VerificationResult> => {
      recorder.verified.push(kind);
      if (input.verifyError !== undefined) throw input.verifyError;
      return input.verifications?.[kind] ?? clean(kind);
    },
  });
  const repairAspect = (key: string) => ({
    plan: async (): Promise<RepairPlan> => {
      recorder.planned.push(key);
      return plan();
    },
    run: async (): Promise<RepairReport> => {
      recorder.ran.push(key);
      if (input.repairError !== undefined) throw input.repairError;
      return report;
    },
  });
  const kit = {
    targets: {
      list: async () => {
        if (input.listError !== undefined) throw input.listError;
        return input.listResult ?? discovered();
      },
      resolve: async () => {
        if (input.resolveError !== undefined) throw input.resolveError;
        return target;
      },
    },
    verify: {
      minecraft: verifyAspect(VerificationKinds.MINECRAFT),
      fabric: verifyAspect(VerificationKinds.FABRIC),
      forge: verifyAspect(VerificationKinds.FORGE),
      runtime: verifyAspect(VerificationKinds.RUNTIME),
    },
    repair: {
      minecraft: repairAspect("minecraft"),
      fabric: repairAspect("fabric"),
      forge: repairAspect("forge"),
      runtime: repairAspect("runtime"),
    },
  };
  return { kit: kit as unknown as MinecraftKit, recorder };
};

const ctxFor = (ui: StubUi, kit: MinecraftKit) => ({ kit, ui, rootDir: ROOT_DIR, auth: auth() });

const logs = (ui: StubUi): string[] =>
  ui.calls.filter((c) => c.kind === "log").map((c) => `${c.level}: ${c.message}`);

describe("pickInstalledTarget failures", () => {
  it("reports a discovery failure instead of throwing out of the scenario", async () => {
    const ui = createStubUi([]);
    const { kit } = buildKit({
      listError: new MinecraftKitError(
        MinecraftKitErrorCodes.FILESYSTEM_READ_ERROR,
        "root unreadable",
      ),
    });

    expect(await scenarioVerify(ctxFor(ui, kit))).toBe("cancelled");
    expect(logs(ui)).toEqual([expect.stringContaining("error:")]);
  });

  it("tells the user to install something first when the root is empty", async () => {
    const ui = createStubUi([]);
    const { kit, recorder } = buildKit({ listResult: [] });

    expect(await scenarioVerify(ctxFor(ui, kit))).toBe("cancelled");
    expect(logs(ui)).toEqual([`warn: No installations under ${ROOT_DIR}. Install one first.`]);
    expect(recorder.verified).toEqual([]);
  });

  it("cancels when the installation pick is abandoned", async () => {
    const ui = createStubUi(["cancel"]);
    const { kit, recorder } = buildKit();

    expect(await scenarioVerify(ctxFor(ui, kit))).toBe("cancelled");
    expect(recorder.verified).toEqual([]);
  });

  it("cancels when the chosen id is not in the discovered list", async () => {
    const ui = createStubUi(["ghost"]);
    const { kit, recorder } = buildKit();

    expect(await scenarioVerify(ctxFor(ui, kit))).toBe("cancelled");
    expect(recorder.verified).toEqual([]);
  });

  it("warns when the installation has no Minecraft version on disk", async () => {
    const ui = createStubUi(["demo"]);
    const { kit } = buildKit({ listResult: discovered({ minecraftVersions: [] }) });

    expect(await scenarioVerify(ctxFor(ui, kit))).toBe("cancelled");
    expect(logs(ui)).toEqual(["warn: Installation has no Minecraft versions on disk."]);
  });

  it("asks which version to use when several are on disk, and cancels on abort", async () => {
    const ui = createStubUi(["demo", "cancel"]);
    const { kit } = buildKit({
      listResult: discovered({ minecraftVersions: ["1.20.1", "1.19.4"] }),
    });

    expect(await scenarioVerify(ctxFor(ui, kit))).toBe("cancelled");
    expect(ui.calls.filter((c) => c.kind === "select").map((c) => c.message)).toEqual([
      "Pick an installation",
      "Multiple Minecraft versions on disk — pick one",
    ]);
  });

  it("reports a resolve failure (offline metadata) rather than crashing", async () => {
    const ui = createStubUi(["demo"]);
    const { kit } = buildKit({
      resolveError: new MinecraftKitError(
        MinecraftKitErrorCodes.NETWORK_HTTP_ERROR,
        "manifest unreachable",
      ),
    });

    expect(await scenarioVerify(ctxFor(ui, kit))).toBe("cancelled");
    expect(logs(ui)).toEqual([expect.stringContaining("error:")]);
  });
});

describe("scenarioVerify", () => {
  it("verifies minecraft + runtime only for a vanilla target", async () => {
    const ui = createStubUi(["demo"]);
    const { kit, recorder } = buildKit();

    expect(await scenarioVerify(ctxFor(ui, kit))).toBe("completed");
    expect(recorder.verified).toEqual([VerificationKinds.MINECRAFT, VerificationKinds.RUNTIME]);
    expect(logs(ui)).toEqual([`success: ${fakeTarget.id} is clean.`]);
  });

  it("adds the Fabric aspect for a Fabric target", async () => {
    const ui = createStubUi(["demo"]);
    const { kit, recorder } = buildKit({
      target: {
        ...fakeTarget,
        loader: {
          type: Loaders.FABRIC,
          minecraftVersion: "1.20.1",
          loaderVersion: "0.14.21",
          profile: {
            id: "fabric-loader-0.14.21-1.20.1",
            inheritsFrom: "1.20.1",
            type: "release",
            mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
            libraries: [],
          },
        } as Target["loader"],
      },
    });

    await scenarioVerify(ctxFor(ui, kit));

    expect(recorder.verified).toEqual([
      VerificationKinds.MINECRAFT,
      VerificationKinds.FABRIC,
      VerificationKinds.RUNTIME,
    ]);
  });

  it("adds the Forge aspect for a Forge target", async () => {
    const ui = createStubUi(["demo"]);
    const { kit, recorder } = buildKit({
      target: {
        ...fakeTarget,
        loader: {
          type: Loaders.FORGE,
          minecraftVersion: "1.20.1",
          forgeVersion: "47.2.0",
          fullVersion: "1.20.1-forge-47.2.0",
          installerUrl: "https://forge/installer.jar",
        } as Target["loader"],
      },
    });

    await scenarioVerify(ctxFor(ui, kit));

    expect(recorder.verified).toContain(VerificationKinds.FORGE);
  });

  it("breaks the issue count down per aspect and points at Repair", async () => {
    const ui = createStubUi(["demo"]);
    const { kit } = buildKit({
      verifications: {
        [VerificationKinds.MINECRAFT]: broken(VerificationKinds.MINECRAFT, 2),
        [VerificationKinds.RUNTIME]: broken(VerificationKinds.RUNTIME, 1),
      },
    });

    expect(await scenarioVerify(ctxFor(ui, kit))).toBe("completed");
    expect(logs(ui)).toEqual([
      'warn: demo: 3 issue(s) (minecraft: 2, runtime: 1). Run "Repair" to fix.',
    ]);
  });

  it("stops the spinner and reports the error when an aspect verifier throws", async () => {
    const ui = createStubUi(["demo"]);
    const { kit } = buildKit({
      verifyError: new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_TIMEOUT, "idx timed out"),
    });

    expect(await scenarioVerify(ctxFor(ui, kit))).toBe("cancelled");
    expect(ui.calls.filter((c) => c.kind === "spinner-stop").map((c) => c.message)).toEqual([
      "Verification failed.",
    ]);
    expect(logs(ui)).toEqual([expect.stringContaining("error:")]);
  });
});

describe("scenarioRepair", () => {
  it("reports a clean install without planning anything", async () => {
    const ui = createStubUi(["demo"]);
    const { kit, recorder } = buildKit();

    expect(await scenarioRepair(ctxFor(ui, kit))).toBe("completed");
    expect(recorder.planned).toEqual([]);
    expect(logs(ui)).toEqual(["success: Installation is already clean."]);
  });

  it("aborts when the repair confirmation is declined", async () => {
    const ui = createStubUi(["demo", false]);
    const { kit, recorder } = buildKit({
      verifications: { [VerificationKinds.MINECRAFT]: broken(VerificationKinds.MINECRAFT, 2) },
    });

    expect(await scenarioRepair(ctxFor(ui, kit))).toBe("cancelled");
    expect(recorder.planned).toEqual([]);
  });

  it("repairs only the aspects that reported issues", async () => {
    const ui = createStubUi(["demo", true]);
    const { kit, recorder } = buildKit({
      verifications: { [VerificationKinds.RUNTIME]: broken(VerificationKinds.RUNTIME, 1) },
    });

    expect(await scenarioRepair(ctxFor(ui, kit))).toBe("completed");
    expect(recorder.planned).toEqual(["runtime"]);
    expect(recorder.ran).toEqual(["runtime"]);
    expect(ui.calls.some((c) => c.kind === "note" && c.message === "Repair runtime summary")).toBe(
      true,
    );
  });

  // A plan that filters down to nothing must not open a progress renderer that never finishes.
  it("skips an aspect whose plan has no actions", async () => {
    const ui = createStubUi(["demo", true]);
    const { kit, recorder } = buildKit({
      planActions: 0,
      verifications: { [VerificationKinds.MINECRAFT]: broken(VerificationKinds.MINECRAFT, 1) },
    });

    expect(await scenarioRepair(ctxFor(ui, kit))).toBe("completed");
    expect(recorder.planned).toEqual(["minecraft"]);
    expect(recorder.ran).toEqual([]);
  });

  it("fails the progress renderer and stops when a repair run throws", async () => {
    const ui = createStubUi(["demo", true]);
    const { kit, recorder } = buildKit({
      verifications: {
        [VerificationKinds.MINECRAFT]: broken(VerificationKinds.MINECRAFT, 1),
        [VerificationKinds.RUNTIME]: broken(VerificationKinds.RUNTIME, 1),
      },
      repairError: new MinecraftKitError(
        MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH,
        "client jar hash mismatch",
      ),
    });

    expect(await scenarioRepair(ctxFor(ui, kit))).toBe("cancelled");
    // The runtime aspect must not be attempted after minecraft failed — a half-repaired install
    // reported as "completed" is worse than a clear stop.
    expect(recorder.ran).toEqual(["minecraft"]);
    expect(logs(ui).at(-1)).toContain("error:");
  });
});
