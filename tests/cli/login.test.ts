import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/cli/open-browser", () => ({
  openBrowser: vi.fn(async () => true),
  pickCommand: () => ({ command: "noop", args: [] }),
}));

import { CLIENT_ID_ENV_VAR } from "../../src/auth/client-id";
import { openBrowser } from "../../src/cli/open-browser";
import type { AuthRef } from "../../src/cli/scenarios";
import { pickInitialAuth, scenarioLogin } from "../../src/cli/scenarios/login";
import type { Ui } from "../../src/cli/ui";
import { createStubUi, type StubUi } from "../../src/cli/ui";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../../src/core/errors";
import { asPlayerUuid } from "../../src/core/uuid";
import type { MinecraftKit } from "../../src/kit";
import { AuthModes, type AzureClientId, type MojangSession } from "../../src/types/auth";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";

const session = (username = "Notch", expiresInMs = 30 * 60 * 1000): MojangSession => ({
  minecraft: {
    username,
    uuid: asPlayerUuid("f81d4fae-7dec-11d0-a765-00a0c91e6bf6"),
    accessToken: "mc-token",
    expiresAt: Date.now() + expiresInMs,
    xuid: "2535400000000000",
    skins: [],
  },
  microsoft: {
    refreshToken: "refresh-token" as MojangSession["microsoft"]["refreshToken"],
    clientId: CLIENT_ID as AzureClientId,
  },
});

type AuthKitInput = {
  readonly loginResult?: MojangSession | (() => Promise<MojangSession>);
  readonly refreshResult?: MojangSession | (() => Promise<MojangSession>);
};

const settle = async <T>(value: T | (() => Promise<T>)): Promise<T> =>
  typeof value === "function" ? await (value as () => Promise<T>)() : value;

/** Records the `onOpenBrowser` callback the scenario handed to `authorizationCode.run`. */
const authKit = (
  input: AuthKitInput = {},
): { readonly kit: MinecraftKit; readonly runs: { clientId: string }[] } => {
  const runs: { clientId: string }[] = [];
  const kit = {
    auth: {
      authorizationCode: {
        async run(options: {
          clientId: string;
          onOpenBrowser?: (url: string) => Promise<void>;
        }): Promise<MojangSession> {
          runs.push({ clientId: options.clientId });
          await options.onOpenBrowser?.("https://login.microsoftonline.com/authorize?a=1&b=2");
          if (input.loginResult === undefined) {
            throw new MinecraftKitError(
              MinecraftKitErrorCodes.AUTH_AUTHORIZATION_CODE_DECLINED,
              "user closed the browser",
            );
          }
          return await settle(input.loginResult);
        },
      },
      async refresh(): Promise<MojangSession> {
        if (input.refreshResult === undefined) {
          throw new MinecraftKitError(
            MinecraftKitErrorCodes.AUTH_REFRESH_FAILED,
            "refresh token rejected",
          );
        }
        return await settle(input.refreshResult);
      },
    },
  };
  return { kit: kit as unknown as MinecraftKit, runs };
};

const onlineAuthRef = (active = session()): AuthRef => ({
  state: {
    kind: "online",
    session: active,
    auth: {
      mode: AuthModes.ONLINE,
      username: active.minecraft.username,
      uuid: active.minecraft.uuid,
      accessToken: active.minecraft.accessToken,
      userType: "msa",
    },
  },
});

const ctxFor = (
  ui: Ui,
  kit: MinecraftKit,
  auth: AuthRef,
): { kit: MinecraftKit; ui: Ui; rootDir: string; auth: AuthRef } => ({
  kit,
  ui,
  rootDir: "/tmp/mckit-login",
  auth,
});

const noteBodies = (ui: StubUi): string[] =>
  ui.calls.filter((call) => call.kind === "note").map((call) => call.body ?? "");

const logs = (ui: StubUi): string[] =>
  ui.calls.filter((call) => call.kind === "log").map((call) => `${call.level}: ${call.message}`);

let savedClientId: string | undefined;

beforeEach(() => {
  savedClientId = process.env[CLIENT_ID_ENV_VAR];
  process.env[CLIENT_ID_ENV_VAR] = CLIENT_ID;
  vi.mocked(openBrowser).mockResolvedValue(true);
});

afterEach(() => {
  if (savedClientId === undefined) delete process.env[CLIENT_ID_ENV_VAR];
  else process.env[CLIENT_ID_ENV_VAR] = savedClientId;
  vi.clearAllMocks();
});

describe("pickInitialAuth failure paths", () => {
  it("falls back to the offline prompt when the browser sign-in throws", async () => {
    const ui = createStubUi(["browser", "Steve"]);
    const { kit } = authKit();

    const state = await pickInitialAuth(ctxFor(ui, kit, onlineAuthRef()));

    expect(state).toEqual({
      kind: "offline",
      auth: { mode: AuthModes.OFFLINE, username: "Steve" },
    });
    // The user must be told the sign-in failed *and* why, not silently dropped to offline.
    expect(logs(ui)).toEqual([
      expect.stringContaining("error:"),
      "warn: Sign-in failed — continuing in offline mode.",
    ]);
  });

  it("returns unauthenticated when the mode prompt is cancelled", async () => {
    const ui = createStubUi(["cancel"]);
    const { kit, runs } = authKit();

    expect(await pickInitialAuth(ctxFor(ui, kit, onlineAuthRef()))).toEqual({
      kind: "unauthenticated",
    });
    expect(runs).toEqual([]);
  });

  it("returns unauthenticated when the offline username prompt is cancelled", async () => {
    const ui = createStubUi(["offline", "cancel"]);
    const { kit } = authKit();

    expect(await pickInitialAuth(ctxFor(ui, kit, onlineAuthRef()))).toEqual({
      kind: "unauthenticated",
    });
  });

  it("trims the offline username", async () => {
    const ui = createStubUi(["offline", "  Alex  "]);
    const { kit } = authKit();

    expect(await pickInitialAuth(ctxFor(ui, kit, onlineAuthRef()))).toEqual({
      kind: "offline",
      auth: { mode: AuthModes.OFFLINE, username: "Alex" },
    });
  });

  it("signs in and derives the online auth from the session", async () => {
    const ui = createStubUi(["browser"]);
    const active = session("Notch");
    const { kit, runs } = authKit({ loginResult: active });

    const state = await pickInitialAuth(ctxFor(ui, kit, onlineAuthRef()));

    expect(state).toMatchObject({
      kind: "online",
      auth: { mode: AuthModes.ONLINE, username: "Notch", accessToken: "mc-token" },
    });
    expect(runs).toEqual([{ clientId: CLIENT_ID }]);
  });
});

describe("browser-open fallback", () => {
  it("prints the authorize URL in the note when the browser could not be opened", async () => {
    vi.mocked(openBrowser).mockResolvedValue(false);
    const ui = createStubUi(["browser"]);
    const { kit } = authKit({ loginResult: session() });

    await pickInitialAuth(ctxFor(ui, kit, onlineAuthRef()));

    const body = noteBodies(ui).join("\n");
    expect(body).toContain("Open the following URL in your browser");
    // The full URL must survive verbatim — a `&`-truncated OAuth URL is a silent sign-in failure.
    expect(body).toContain("https://login.microsoftonline.com/authorize?a=1&b=2");
  });

  it("omits the URL when the browser opened itself", async () => {
    const ui = createStubUi(["browser"]);
    const { kit } = authKit({ loginResult: session() });

    await pickInitialAuth(ctxFor(ui, kit, onlineAuthRef()));

    const body = noteBodies(ui).join("\n");
    expect(body).toContain("Your default browser was opened automatically");
    expect(body).not.toContain("https://login.microsoftonline.com");
  });
});

describe("client id resolution", () => {
  it("warns and prompts when the env var holds a malformed client id", async () => {
    process.env[CLIENT_ID_ENV_VAR] = "not-a-guid";
    const ui = createStubUi(["browser", CLIENT_ID]);
    const { kit, runs } = authKit({ loginResult: session() });

    await pickInitialAuth(ctxFor(ui, kit, onlineAuthRef()));

    expect(logs(ui)[0]).toContain(`warn: Ignoring ${CLIENT_ID_ENV_VAR}`);
    expect(runs).toEqual([{ clientId: CLIENT_ID }]);
  });

  it("prompts when the env var is unset and treats an empty answer as a decline", async () => {
    delete process.env[CLIENT_ID_ENV_VAR];
    const ui = createStubUi(["browser", "   ", "Steve"]);
    const { kit, runs } = authKit({ loginResult: session() });

    const state = await pickInitialAuth(ctxFor(ui, kit, onlineAuthRef()));

    expect(runs).toEqual([]);
    expect(state).toEqual({
      kind: "offline",
      auth: { mode: AuthModes.OFFLINE, username: "Steve" },
    });
  });

  it("rejects a non-GUID client id through the prompt validator", async () => {
    delete process.env[CLIENT_ID_ENV_VAR];
    const validations: (string | undefined)[] = [];
    const ui = createStubUi(["browser", CLIENT_ID]);
    // The stub UI never runs `validate`, so drive it explicitly: the GUID guard is the only
    // thing standing between a typo and an opaque Microsoft 400.
    const probing: Ui = {
      ...ui,
      text: async (input) => {
        validations.push(input.validate?.("nope"));
        validations.push(input.validate?.(`  ${CLIENT_ID}  `));
        validations.push(input.validate?.(""));
        return await ui.text(input);
      },
    };
    const { kit } = authKit({ loginResult: session() });

    await pickInitialAuth(ctxFor(probing, kit, onlineAuthRef()));

    expect(validations).toEqual(["Expected the 8-4-4-4-12 GUID format", undefined, undefined]);
  });

  it("rejects an empty offline username through the prompt validator", async () => {
    const validations: (string | undefined)[] = [];
    const ui = createStubUi(["offline", "Steve"]);
    const probing: Ui = {
      ...ui,
      text: async (input) => {
        validations.push(input.validate?.("   "));
        validations.push(input.validate?.("Steve"));
        return await ui.text(input);
      },
    };
    const { kit } = authKit();

    await pickInitialAuth(ctxFor(probing, kit, onlineAuthRef()));

    expect(validations).toEqual(["Username must be non-empty", undefined]);
  });
});

describe("scenarioLogin (online session)", () => {
  it("shows session details without touching the network", async () => {
    const ui = createStubUi(["info"]);
    const { kit, runs } = authKit();
    const auth = onlineAuthRef(session("Notch"));

    expect(await scenarioLogin(ctxFor(ui, kit, auth))).toBe("completed");

    const body = noteBodies(ui).join("\n");
    expect(body).toContain("Player:       Notch");
    expect(body).toContain("XUID:         2535400000000000");
    expect(body).toMatch(/Token expires: in ~(29|30) min/);
    expect(runs).toEqual([]);
    expect(auth.state.kind).toBe("online");
  });

  it("renders an em dash for a session with no XUID and clamps a stale expiry to 0", async () => {
    const stale = session("Notch", -60 * 60 * 1000);
    const ui = createStubUi(["info"]);
    const { kit } = authKit();

    await scenarioLogin(
      ctxFor(ui, kit, onlineAuthRef({ ...stale, minecraft: { ...stale.minecraft, xuid: "" } })),
    );

    const body = noteBodies(ui).join("\n");
    expect(body).toContain("XUID:         —");
    expect(body).toContain("Token expires: in ~0 min");
  });

  it("keeps the old session and reports the failure when the refresh is rejected", async () => {
    const ui = createStubUi(["refresh"]);
    const { kit } = authKit();
    const original = session("Notch");
    const auth = onlineAuthRef(original);

    expect(await scenarioLogin(ctxFor(ui, kit, auth))).toBe("cancelled");

    expect(auth.state).toMatchObject({ kind: "online", session: original });
    expect(logs(ui)).toEqual([expect.stringContaining("error:")]);
    expect(ui.calls.at(-1)).toMatchObject({ kind: "log", level: "error" });
  });

  it("replaces the session on a successful refresh", async () => {
    const refreshed = session("Notch");
    const ui = createStubUi(["refresh"]);
    const { kit } = authKit({ refreshResult: refreshed });
    const auth = onlineAuthRef(session("Notch"));

    expect(await scenarioLogin(ctxFor(ui, kit, auth))).toBe("completed");

    expect(auth.state).toMatchObject({ kind: "online", session: refreshed });
  });

  it("drops to offline mode on sign-out", async () => {
    const ui = createStubUi(["logout", "Steve"]);
    const { kit } = authKit();
    const auth = onlineAuthRef();

    expect(await scenarioLogin(ctxFor(ui, kit, auth))).toBe("completed");

    expect(auth.state).toEqual({
      kind: "offline",
      auth: { mode: AuthModes.OFFLINE, username: "Steve" },
    });
  });

  // Cancelling the username prompt during sign-out must not half-apply the sign-out.
  it("keeps the online session when the sign-out username prompt is cancelled", async () => {
    const ui = createStubUi(["logout", "cancel"]);
    const { kit } = authKit();
    const auth = onlineAuthRef();

    expect(await scenarioLogin(ctxFor(ui, kit, auth))).toBe("cancelled");
    expect(auth.state.kind).toBe("online");
  });

  it("returns cancelled from the Back option and from an aborted menu", async () => {
    const { kit } = authKit();

    const back = createStubUi(["back"]);
    expect(await scenarioLogin(ctxFor(back, kit, onlineAuthRef()))).toBe("cancelled");

    const cancelled = createStubUi(["cancel"]);
    expect(await scenarioLogin(ctxFor(cancelled, kit, onlineAuthRef()))).toBe("cancelled");
  });

  it("keeps the previous session when Switch account is abandoned", async () => {
    const ui = createStubUi(["switch", "cancel"]);
    const { kit } = authKit();
    const original = session("Notch");
    const auth = onlineAuthRef(original);

    expect(await scenarioLogin(ctxFor(ui, kit, auth))).toBe("cancelled");
    expect(auth.state).toMatchObject({ kind: "online", session: original });
  });

  it("switches to a different account", async () => {
    const ui = createStubUi(["switch", "offline", "Alex"]);
    const { kit } = authKit();
    const auth = onlineAuthRef();

    expect(await scenarioLogin(ctxFor(ui, kit, auth))).toBe("completed");
    expect(auth.state).toEqual({
      kind: "offline",
      auth: { mode: AuthModes.OFFLINE, username: "Alex" },
    });
  });
});

describe("scenarioLogin (offline session)", () => {
  it("goes straight to the account switch", async () => {
    const ui = createStubUi(["offline", "Alex"]);
    const { kit } = authKit();
    const auth: AuthRef = {
      state: { kind: "offline", auth: { mode: AuthModes.OFFLINE, username: "Player" } },
    };

    expect(await scenarioLogin(ctxFor(ui, kit, auth))).toBe("completed");
    expect(auth.state).toEqual({
      kind: "offline",
      auth: { mode: AuthModes.OFFLINE, username: "Alex" },
    });
    // No "Signed in as …" menu for an offline state.
    expect(ui.calls.filter((call) => call.kind === "select")[0]?.message).toBe(
      "How do you want to play?",
    );
  });
});
