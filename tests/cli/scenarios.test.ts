import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  scenarioInspect,
  scenarioInstallMinecraft,
  scenarioInstallRuntime,
  scenarioLaunch,
  scenarioRepair,
  scenarioVerify,
} from "../../src/cli/scenarios";
import type { AuthState } from "../../src/cli/scenarios";
import { createStubUi } from "../../src/cli/ui";
import { MinecraftKitError } from "../../src/core/errors";
import { AuthModes } from "../../src/types/auth";
import type { FabricLoaderSummary } from "../../src/types/fabric";
import type { ForgeBuildSummary } from "../../src/types/forge";
import { Loaders } from "../../src/types/loader";
import type { MinecraftVersionSummary } from "../../src/types/minecraft";
import type { DiscoveredTarget } from "../../src/types/target";
import { buildFakeKit, fakeTarget } from "../helpers/fake-kit";

const ROOT_DIR = "/tmp/mckit-test";

/**
 * Default auth state used by every scenario test. Scenarios that don't touch auth
 * (install / verify / repair / inspect) ignore it; `scenarioLaunch` consumes the offline
 * username directly.
 */
const auth = (): AuthState => ({
  current: { mode: AuthModes.OFFLINE, username: "Player" },
  microsoftSession: null,
});

const release2: MinecraftVersionSummary = {
  id: "1.20.1",
  type: "release",
  url: "https://m/",
  time: "",
  releaseTime: "2023-06-01T00:00:00+00:00",
  sha1: "x",
  complianceLevel: 1,
};

const fabricLoaders: readonly FabricLoaderSummary[] = [
  { version: "0.16.0", stable: false, maven: "x", build: 0, separator: "." },
  { version: "0.14.21", stable: true, maven: "x", build: 0, separator: "." },
];

const forgeBuilds: readonly ForgeBuildSummary[] = [
  {
    fullVersion: "1.20.1-47.2.0",
    minecraftVersion: "1.20.1",
    forgeVersion: "47.2.0",
    isRecommended: true,
    isLatest: false,
  },
  {
    fullVersion: "1.20.1-47.2.5",
    minecraftVersion: "1.20.1",
    forgeVersion: "47.2.5",
    isRecommended: false,
    isLatest: true,
  },
];

describe("scenarioInstallMinecraft (vanilla path)", () => {
  it("walks channel → version → runtime auto → vanilla → directory → confirm", async () => {
    const ui = createStubUi(["release", release2, "auto", Loaders.VANILLA, "default", true]);
    const kit = buildFakeKit();
    expect(await scenarioInstallMinecraft({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe(
      "completed",
    );
  });

  it("supports back navigation from runtime → version → channel", async () => {
    const ui = createStubUi([
      "release",
      release2,
      "back",
      release2,
      "auto",
      Loaders.VANILLA,
      "default",
      true,
    ]);
    const kit = buildFakeKit();
    expect(await scenarioInstallMinecraft({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe(
      "completed",
    );
  });

  it("uses custom directory path when chosen", async () => {
    const ui = createStubUi([
      "release",
      release2,
      "auto",
      Loaders.VANILLA,
      "custom",
      "/tmp/custom-dir",
      true,
    ]);
    const kit = buildFakeKit();
    expect(await scenarioInstallMinecraft({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe(
      "completed",
    );
  });

  it("cancels at the channel step", async () => {
    const ui = createStubUi(["cancel"]);
    const kit = buildFakeKit();
    expect(await scenarioInstallMinecraft({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe(
      "cancelled",
    );
  });

  it("declines summary confirm and aborts", async () => {
    const ui = createStubUi(["release", release2, "auto", Loaders.VANILLA, "default", false]);
    const kit = buildFakeKit();
    expect(await scenarioInstallMinecraft({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe(
      "cancelled",
    );
  });
});

describe("scenarioInstallMinecraft (Fabric path)", () => {
  it("picks Fabric loader after install-type selection", async () => {
    const ui = createStubUi([
      "release",
      release2,
      "auto",
      Loaders.FABRIC,
      "0.14.21",
      "default",
      true,
    ]);
    const kit = buildFakeKit({ fabricLoaders });
    expect(await scenarioInstallMinecraft({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe(
      "completed",
    );
  });

  it("falls back to install-type when Fabric is incompatible (empty)", async () => {
    const ui = createStubUi([
      "release",
      release2,
      "auto",
      Loaders.FABRIC,
      Loaders.VANILLA,
      "default",
      true,
    ]);
    const kit = buildFakeKit({ fabricLoaders: [] });
    expect(await scenarioInstallMinecraft({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe(
      "completed",
    );
  });

  it("falls back to install-type when Fabric API throws (e.g. HTTP 400)", async () => {
    const ui = createStubUi([
      "release",
      release2,
      "auto",
      Loaders.FABRIC,
      Loaders.VANILLA,
      "default",
      true,
    ]);
    const kit = buildFakeKit({
      fabricLoaders: async () => {
        throw new MinecraftKitError("NETWORK_HTTP_ERROR", "HTTP 400", {
          context: { httpStatus: 400 },
        });
      },
    });
    expect(await scenarioInstallMinecraft({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe(
      "completed",
    );
  });
});

describe("scenarioInstallMinecraft (Forge path)", () => {
  it("picks Forge build after install-type selection", async () => {
    const ui = createStubUi([
      "release",
      release2,
      "auto",
      Loaders.FORGE,
      "47.2.0",
      "default",
      true,
    ]);
    const kit = buildFakeKit({ forgeBuilds });
    expect(await scenarioInstallMinecraft({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe(
      "completed",
    );
  });

  it("falls back to install-type when Forge is incompatible", async () => {
    const ui = createStubUi([
      "release",
      release2,
      "auto",
      Loaders.FORGE,
      Loaders.VANILLA,
      "default",
      true,
    ]);
    const kit = buildFakeKit({ forgeBuilds: [] });
    expect(await scenarioInstallMinecraft({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe(
      "completed",
    );
  });
});

describe("scenarioInstallMinecraft (runtime override)", () => {
  it("offers a runtime list when 'specific' is chosen", async () => {
    const ui = createStubUi([
      "release",
      release2,
      "specific",
      "java-runtime-gamma",
      Loaders.VANILLA,
      "default",
      true,
    ]);
    const kit = buildFakeKit({
      runtimeList: [
        { component: "java-runtime-gamma", versionName: "17.0.8" },
        { component: "jre-legacy", versionName: "8.0.412" },
      ],
    });
    expect(await scenarioInstallMinecraft({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe(
      "completed",
    );
  });
});

describe("scenarioInstallRuntime", () => {
  it("installs the picked runtime component without asking for a Minecraft version", async () => {
    const ui = createStubUi(["java-runtime-gamma", "default", "per-target", true]);
    const kit = buildFakeKit({
      runtimeList: [{ component: "java-runtime-gamma", versionName: "17.0.8" }],
    });
    expect(await scenarioInstallRuntime({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe(
      "completed",
    );
  });

  it("threads a custom installRoot through into the runtime install", async () => {
    const ui = createStubUi(["java-runtime-gamma", "default", "custom", "C:/shared/jre", true]);
    const kit = buildFakeKit({
      runtimeList: [{ component: "java-runtime-gamma", versionName: "17.0.8" }],
    });
    expect(await scenarioInstallRuntime({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe(
      "completed",
    );
  });
});

describe("scenarioVerify", () => {
  it("warns when no installations are found", async () => {
    const ui = createStubUi();
    const kit = buildFakeKit({ listResult: [] });
    expect(await scenarioVerify({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe("cancelled");
  });

  it("verifies a clean installation", async () => {
    const ui = createStubUi([fakeTarget.id]);
    const kit = buildFakeKit({ listResult: [discoveredFor(fakeTarget.id)] });
    expect(await scenarioVerify({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe("completed");
  });

  it("warns when issues are present", async () => {
    const ui = createStubUi([fakeTarget.id]);
    const kit = buildFakeKit({
      listResult: [discoveredFor(fakeTarget.id)],
      verificationResult: {
        targetId: fakeTarget.id,
        kind: "minecraft",
        isValid: false,
        issues: [{ path: "/x", category: "library", status: "missing" }],
        checkedFiles: 1,
        durationMs: 1,
      },
    });
    expect(await scenarioVerify({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe("completed");
  });
});

describe("scenarioRepair", () => {
  it("reports clean when nothing to fix", async () => {
    const ui = createStubUi([fakeTarget.id]);
    const kit = buildFakeKit({ listResult: [discoveredFor(fakeTarget.id)] });
    expect(await scenarioRepair({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe("completed");
  });

  it("repairs when issues are present and confirmed", async () => {
    const ui = createStubUi([fakeTarget.id, true]);
    const kit = buildFakeKit({
      listResult: [discoveredFor(fakeTarget.id)],
      verificationResult: {
        targetId: fakeTarget.id,
        kind: "minecraft",
        isValid: false,
        issues: [{ path: "/x", category: "library", status: "missing" }],
        checkedFiles: 1,
        durationMs: 1,
      },
    });
    expect(await scenarioRepair({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe("completed");
  });

  it("cancels when user declines repair", async () => {
    const ui = createStubUi([fakeTarget.id, false]);
    const kit = buildFakeKit({
      listResult: [discoveredFor(fakeTarget.id)],
      verificationResult: {
        targetId: fakeTarget.id,
        kind: "minecraft",
        isValid: false,
        issues: [{ path: "/x", category: "library", status: "missing" }],
        checkedFiles: 1,
        durationMs: 1,
      },
    });
    expect(await scenarioRepair({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe("cancelled");
  });
});

describe("scenarioLaunch", () => {
  it("prompts only for target + spawn confirm (auth was picked at runCli startup)", async () => {
    const ui = createStubUi([fakeTarget.id, true]);
    const kit = buildFakeKit({ listResult: [discoveredFor(fakeTarget.id)] });
    expect(await scenarioLaunch({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe("completed");
  });

  it("cancels when launch confirm declined", async () => {
    const ui = createStubUi([fakeTarget.id, false]);
    const kit = buildFakeKit({ listResult: [discoveredFor(fakeTarget.id)] });
    expect(await scenarioLaunch({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe("cancelled");
  });

  it("warns when no installations exist", async () => {
    const ui = createStubUi();
    const kit = buildFakeKit({ listResult: [] });
    expect(await scenarioLaunch({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe("cancelled");
  });
});

describe("scenarioInspect", () => {
  it("warns when empty", async () => {
    const ui = createStubUi();
    const kit = buildFakeKit({ listResult: [] });
    expect(await scenarioInspect({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe("completed");
  });

  it("shows a detailed note for the picked installation", async () => {
    const ui = createStubUi(["alpha"]);
    const kit = buildFakeKit({ listResult: [discoveredFor("alpha")] });
    expect(await scenarioInspect({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe("completed");
    const note = ui.calls.find((c) => c.kind === "note");
    expect(note?.message).toBe("Inspect: alpha");
    expect(note?.body).toContain("Directory:");
    expect(note?.body).toContain("Runtime path:");
  });

  it("cancels when user picks cancel", async () => {
    const ui = createStubUi(["cancel"]);
    const kit = buildFakeKit({ listResult: [discoveredFor("alpha")] });
    expect(await scenarioInspect({ kit, ui, rootDir: ROOT_DIR, auth: auth() })).toBe("cancelled");
  });
});

const discoveredFor = (id: string): DiscoveredTarget => {
  return {
    id,
    directory: path.join(ROOT_DIR, id),
    minecraftVersions: ["1.20.1"],
    loaders: [{ type: Loaders.VANILLA, minecraftVersion: "1.20.1" }],
  };
};
