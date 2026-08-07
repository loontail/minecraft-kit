import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../src/core/errors";
import { PauseController } from "../src/core/pause-controller";
import { createMemoryCache } from "../src/http/cache";
import { MinecraftKit } from "../src/kit";
import { DownloadCategories } from "../src/types/install";
import { VerificationKinds, type VerificationResult } from "../src/types/verify";
import { FakeHttpClient } from "./helpers/fake-http";
import { FakeSpawner } from "./helpers/fake-spawner";
import { buildForgeTarget, createForgeHttp, forgeMinecraft } from "./helpers/forge-fixture";

/**
 * These tests go through the public `MinecraftKit` facade rather than the underlying functions:
 * every aspect builder is pure wiring, and a wiring mistake (an unforwarded `signal`, an aspect
 * pointing at the wrong planner, a `hostAllowList` that never reaches the downloader) type-checks
 * cleanly and breaks the whole public API at runtime.
 */
const system = { os: "windows", arch: "x64", osVersion: "10.0" } as const;

const roots: string[] = [];
const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), "mckit-wiring-"));
  roots.push(root);
  return root;
};

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

// The forge fixture serves from single-label hosts (`https://forge/`, `https://client/`, …),
// which the kit's default Mojang/Fabric/Forge allow-list rejects — as it should.
const FIXTURE_HOSTS: readonly string[] = [
  "forge",
  "client",
  "idx",
  "runtime",
  "runtime-manifest",
  "version",
];

const buildKit = (http = createForgeHttp(), hostAllowList: readonly string[] = FIXTURE_HOSTS) =>
  new MinecraftKit({
    httpClient: http,
    cache: createMemoryCache(),
    spawner: new FakeSpawner(),
    system,
    hostAllowList,
  });

const brokenVerification = (targetId: string, filePath: string): VerificationResult => ({
  targetId,
  kind: VerificationKinds.MINECRAFT,
  isValid: false,
  issues: [{ path: filePath, category: "client-jar", status: "missing" }],
  checkedFiles: 1,
  durationMs: 1,
});

describe("MinecraftKit defaults", () => {
  it("builds every surface with no options at all", () => {
    const kit = new MinecraftKit();

    expect(kit.versions.minecraft).toBeDefined();
    expect(kit.targets.system.os).toBeDefined();
    expect(typeof kit.install.plan).toBe("function");
    expect(typeof kit.install.runtime.planStandalone).toBe("function");
    expect(typeof kit.verify.targetReady.run).toBe("function");
    expect(typeof kit.repair.all).toBe("function");
    expect(typeof kit.repair.fromError).toBe("function");
    expect(typeof kit.repair.verifyAndRepair).toBe("function");
    expect(typeof kit.launch.preflight).toBe("function");
    expect(kit.cache.get("nothing")).toBeUndefined();
  });
});

describe("kit.verify wiring", () => {
  it("routes each aspect to its own verifier", async () => {
    const root = await makeRoot();
    const kit = buildKit();
    const target = buildForgeTarget(root);

    const minecraft = await kit.verify.minecraft.run(target);
    const forge = await kit.verify.forge.run(target);
    const runtime = await kit.verify.runtime.run(target);

    expect(minecraft.kind).toBe(VerificationKinds.MINECRAFT);
    expect(forge.kind).toBe(VerificationKinds.FORGE);
    expect(runtime.kind).toBe(VerificationKinds.RUNTIME);
  });

  it("rejects the wrong loader through the aspect that does not apply", async () => {
    const root = await makeRoot();
    const kit = buildKit();

    await expect(kit.verify.fabric.run(buildForgeTarget(root))).rejects.toMatchObject({
      code: MinecraftKitErrorCodes.INVALID_INPUT,
    });
  });

  it("forwards signal and onEvent from the options bag", async () => {
    const root = await makeRoot();
    const kit = buildKit();
    const seen: string[] = [];

    await kit.verify.minecraft.run(buildForgeTarget(root), {
      onEvent: (event) => seen.push(event.type),
    });
    expect(seen.length).toBeGreaterThan(0);

    await expect(
      kit.verify.minecraft.run(buildForgeTarget(root), { signal: AbortSignal.abort("stop") }),
    ).rejects.toMatchObject({ code: MinecraftKitErrorCodes.LAUNCH_ABORTED });
  });

  it("aggregates readiness for launch gating", async () => {
    const root = await makeRoot();
    const kit = buildKit();

    const readiness = await kit.verify.targetReady.run(buildForgeTarget(root));

    expect(readiness.isReady).toBe(false);
    expect(readiness.issues.length).toBeGreaterThan(0);
  });
});

describe("kit.install wiring", () => {
  it("plans a full install and a runtime-only install from the same target", async () => {
    const root = await makeRoot();
    const kit = buildKit();
    const target = buildForgeTarget(root);

    const full = await kit.install.plan(target);
    const runtimeOnly = await kit.install.runtime.plan(target);

    expect(full.totalActions).toBeGreaterThan(runtimeOnly.totalActions);
    expect(
      runtimeOnly.actions.every(
        (action) =>
          action.kind !== "download-file" || action.category === DownloadCategories.RUNTIME_FILE,
      ),
    ).toBe(true);
  });

  it("plans a standalone runtime install outside any target", async () => {
    const root = await makeRoot();
    const kit = buildKit();
    const directory = path.join(root, "shared-runtimes");

    const plan = await kit.install.runtime.planStandalone({
      id: "shared-jre",
      directory,
      runtime: buildForgeTarget(root).runtime,
    });

    expect(plan.targetId).toBe("shared-jre");
    expect(plan.directory).toBe(directory);
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions.every((action) => action.kind === "download-file")).toBe(true);
  });

  // The allow-list is a supply-chain control: download URLs come from remote manifests, so a
  // list that never reaches the downloader is a silently disabled defence.
  it("forwards the host allow-list to the downloader, blocking an off-list URL", async () => {
    const root = await makeRoot();
    const kit = buildKit(createForgeHttp(), ["nothing.example"]);
    const plan = await kit.install.runtime.plan(buildForgeTarget(root));

    await expect(kit.install.run(plan)).rejects.toMatchObject({
      code: MinecraftKitErrorCodes.INVALID_INPUT,
      message: expect.stringContaining("allow-list"),
    });
  });

  it("forwards a pause controller and action-category filter through run", async () => {
    const root = await makeRoot();
    const http = createForgeHttp();
    const kit = buildKit(http);
    const plan = await kit.install.plan(buildForgeTarget(root));
    const before = http.requests.length;

    const report = await kit.install.run(plan, {
      pauseController: new PauseController(),
      actionCategories: new Set([DownloadCategories.RUNTIME_FILE]),
      onEvent: () => {},
    });

    // Only the runtime binary may be fetched — the client jar and Forge library are filtered out.
    expect(http.requests.slice(before).map((request) => request.url)).toEqual([
      "https://runtime/javaw",
    ]);
    // Writes (version JSONs) are unconditional by design, so the filter only trims downloads.
    expect(report.actionsCompleted).toBe(3);
  });
});

describe("kit.repair wiring", () => {
  it("routes each aspect to its own planner", async () => {
    const root = await makeRoot();
    const kit = buildKit();
    const target = buildForgeTarget(root);
    const from = brokenVerification(target.id, path.join(root, "versions", "1.20.1", "1.20.1.jar"));

    const minecraft = await kit.repair.minecraft.plan(target, { from });
    const forge = await kit.repair.forge.plan(target, { from });
    const runtime = await kit.repair.runtime.plan(target, { from });

    expect(minecraft.totalActions).toBe(1);
    expect(forge.totalActions).toBe(0);
    expect(runtime.totalActions).toBe(0);
    await expect(kit.repair.fabric.plan(target, { from })).rejects.toMatchObject({
      code: MinecraftKitErrorCodes.INVALID_INPUT,
    });
  });

  it("honours shouldRepairIssue at the aspect level", async () => {
    const root = await makeRoot();
    const kit = buildKit();
    const target = buildForgeTarget(root);
    const clientJar = path.join(root, "versions", "1.20.1", "1.20.1.jar");

    const plan = await kit.repair.minecraft.plan(target, {
      from: brokenVerification(target.id, clientJar),
      shouldRepairIssue: ({ issue }) => issue.path !== clientJar,
    });

    expect(plan.totalActions).toBe(0);
  });

  it("runs a repair plan through the install runner", async () => {
    const root = await makeRoot();
    const kit = buildKit();
    const target = buildForgeTarget(root);
    const clientJar = path.join(root, "versions", "1.20.1", "1.20.1.jar");
    const plan = await kit.repair.minecraft.plan(target, {
      from: brokenVerification(target.id, clientJar),
    });

    const report = await kit.repair.minecraft.run(plan, { onEvent: () => {} });

    expect(report.actionsCompleted).toBe(1);
    expect(report.bytesDownloaded).toBeGreaterThan(0);
  });

  it("derives a single-file plan from a typed install error", async () => {
    const root = await makeRoot();
    const kit = buildKit();
    const target = buildForgeTarget(root);
    const full = await kit.install.plan(target);
    const firstDownload = full.actions.find((action) => action.kind === "download-file");
    if (firstDownload?.kind !== "download-file") throw new Error("plan has no download action");
    // `url` widens to a mirror list on actions that publish alternates.
    const url = Array.isArray(firstDownload.url) ? firstDownload.url[0] : firstDownload.url;

    const plan = await kit.repair.fromError({
      target,
      error: new MinecraftKitError(
        MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH,
        "hash mismatch",
        { context: { url } },
      ),
    });

    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({
      kind: "download-file",
      target: firstDownload.target,
    });
  });

  it("refuses to guess when the error names a file no install action produces", async () => {
    const root = await makeRoot();
    const kit = buildKit();

    await expect(
      kit.repair.fromError({
        target: buildForgeTarget(root),
        error: new MinecraftKitError(
          MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH,
          "hash mismatch",
          { context: { url: "https://elsewhere.example/not-part-of-the-plan.jar" } },
        ),
      }),
    ).rejects.toMatchObject({ code: MinecraftKitErrorCodes.INVALID_INPUT });
  });

  it("verifies then repairs one aspect in a single call", async () => {
    const root = await makeRoot();
    const kit = buildKit();

    const result = await kit.repair.verifyAndRepair({
      target: buildForgeTarget(root),
      aspect: VerificationKinds.RUNTIME,
    });

    expect(result.verification.kind).toBe(VerificationKinds.RUNTIME);
    expect(result.repair?.actionsCompleted).toBeGreaterThan(0);
  });

  it("repairs every applicable aspect through repair.all", async () => {
    const root = await makeRoot();
    const kit = buildKit();

    const report = await kit.repair.all(buildForgeTarget(root), {
      pauseController: new PauseController(),
      onEvent: () => {},
    });

    expect([...report.repairs.keys()].sort()).toEqual(
      [VerificationKinds.FORGE, VerificationKinds.MINECRAFT, VerificationKinds.RUNTIME].sort(),
    );
  });
});

describe("kit.launch wiring", () => {
  it("reports every launch-critical file as missing on an empty directory", async () => {
    const root = await makeRoot();
    const kit = buildKit();

    const preflight = await kit.launch.preflight(buildForgeTarget(root));

    expect(preflight.isReady).toBe(false);
    expect(preflight.targetId).toBe("forge-target");
  });

  it("rejects an empty username at compose time before anything is spawned", async () => {
    const root = await makeRoot();
    const kit = buildKit();

    await expect(
      kit.launch.compose(buildForgeTarget(root), {
        auth: { mode: "offline", username: "" },
      }),
    ).rejects.toMatchObject({ code: MinecraftKitErrorCodes.INVALID_INPUT });
  });

  it("throws LAUNCH_JAVA_NOT_FOUND from run() when the runtime was never installed", async () => {
    const root = await makeRoot();
    const kit = buildKit();
    const target = buildForgeTarget(root);

    expect(() =>
      kit.launch.run({
        targetId: target.id,
        directory: root,
        javaPath: path.join(root, "runtime", "java-runtime-gamma", "bin", "javaw.exe"),
        mainClass: forgeMinecraft().manifest.mainClass,
        jvmArgs: [],
        gameArgs: [],
        classpath: [],
        nativesDirectory: path.join(root, "natives"),
        auth: { mode: "offline", username: "Player" },
        workingDirectory: root,
      }),
    ).toThrow(MinecraftKitError);
  });
});

describe("kit surfaces share the injected http client", () => {
  it("resolves versions through the same client the aspects use", async () => {
    const http = new FakeHttpClient();
    const kit = buildKit(http);

    await expect(kit.versions.minecraft.list()).rejects.toThrow(/Unmocked URL/);
  });
});
