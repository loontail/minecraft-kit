import {
  AuthModes,
  type AzureClientId,
  CLIENT_ID_ENV_VAR,
  type MojangSession,
  type OfflineAuth,
  type OnlineAuth,
  asAzureClientId,
  assertNever,
  isMinecraftKitError,
  toOnlineAuth,
} from "../../index";
import { formatUserError } from "../error-format";
import { openBrowser } from "../open-browser";
import type { AuthState, ScenarioContext, ScenarioOutcome } from "./types";

type AuthOutcome =
  | { readonly kind: "signed-in"; readonly session: MojangSession; readonly auth: OnlineAuth }
  | { readonly kind: "offline"; readonly auth: OfflineAuth }
  | { readonly kind: "cancelled" };

/**
 * Scenario: shown from the main menu after the initial sign-in already happened at startup.
 * Lets the user inspect the active session, refresh the Microsoft token, sign out (drop
 * back to offline + default username), or switch accounts entirely.
 *
 * @internal
 */
export const scenarioLogin = async (ctx: ScenarioContext): Promise<ScenarioOutcome> => {
  if (ctx.auth.state.kind === "online") {
    const session = ctx.auth.state.session;
    const action = await ctx.ui.select<"info" | "refresh" | "switch" | "logout" | "back">({
      message: `Signed in as ${session.minecraft.username}. What now?`,
      options: [
        { label: "Show session details", value: "info" },
        { label: "Refresh access token", value: "refresh" },
        { label: "Switch account", value: "switch" },
        { label: "Sign out (use offline mode)", value: "logout" },
        { label: "← Back", value: "back" },
      ],
    });
    if (action.kind !== "ok" || action.value === "back") return "cancelled";
    if (action.value === "info") {
      printSession(ctx, session);
      return "completed";
    }
    if (action.value === "logout") {
      const offline = await promptOfflineAuth(ctx);
      if (!offline) return "cancelled";
      ctx.auth.state = { kind: "offline", auth: offline };
      ctx.ui.log("success", "Signed out — switched to offline mode.");
      return "completed";
    }
    if (action.value === "refresh") return await runRefresh(ctx);
    return await runSwitch(ctx);
  }
  return await runSwitch(ctx);
};

/**
 * Used by `runCli` at startup AND by the "Switch account" option. Prompts for
 * offline / Microsoft, runs the browser sign-in flow if needed, and returns
 * the resulting {@link AuthState}. `kind: "unauthenticated"` means the user
 * cancelled — `runCli` treats that as "exit before menu".
 *
 * @internal
 */
export const pickInitialAuth = async (ctx: Omit<ScenarioContext, "auth">): Promise<AuthState> => {
  const outcome = await decideInitialAuth(ctx);
  switch (outcome.kind) {
    case "signed-in":
      return { kind: "online", auth: outcome.auth, session: outcome.session };
    case "offline":
      return { kind: "offline", auth: outcome.auth };
    case "cancelled":
      return { kind: "unauthenticated" };
    default:
      return assertNever(outcome);
  }
};

const decideInitialAuth = async (ctx: Omit<ScenarioContext, "auth">): Promise<AuthOutcome> => {
  const mode = await ctx.ui.select<"offline" | "browser">({
    message: "How do you want to play?",
    options: [
      { label: "Offline mode", value: "offline", hint: "Pick a username, no Microsoft account" },
      {
        label: "Sign in with Microsoft",
        value: "browser",
        hint: "Opens your default browser — no codes to type",
      },
    ],
    initialValue: "browser",
  });
  if (mode.kind !== "ok") return { kind: "cancelled" };
  if (mode.value === "offline") return await chooseOfflineOutcome(ctx);
  const session = await runMicrosoftBrowserLogin(ctx);
  if (session) return { kind: "signed-in", session, auth: toOnlineAuth(session) };
  ctx.ui.log("warn", "Sign-in failed — continuing in offline mode.");
  return await chooseOfflineOutcome(ctx);
};

const chooseOfflineOutcome = async (ctx: Omit<ScenarioContext, "auth">): Promise<AuthOutcome> => {
  const offline = await promptOfflineAuth(ctx);
  return offline ? { kind: "offline", auth: offline } : { kind: "cancelled" };
};

const runSwitch = async (ctx: ScenarioContext): Promise<ScenarioOutcome> => {
  const next = await pickInitialAuth(ctx);
  if (next.kind === "unauthenticated") return "cancelled";
  ctx.auth.state = next;
  return "completed";
};

const runRefresh = async (ctx: ScenarioContext): Promise<ScenarioOutcome> => {
  if (ctx.auth.state.kind !== "online") return "cancelled";
  const session = ctx.auth.state.session;
  const spinner = ctx.ui.spinner();
  spinner.start("Refreshing access token…");
  try {
    const fresh = await ctx.kit.auth.refresh(session.microsoft.refreshToken, {
      clientId: session.microsoft.clientId,
    });
    ctx.auth.state = { kind: "online", auth: toOnlineAuth(fresh), session: fresh };
    spinner.stop("Access token refreshed.");
    printSession(ctx, fresh);
    return "completed";
  } catch (error) {
    spinner.stop("Refresh failed.");
    ctx.ui.log("error", formatUserError(error));
    return "cancelled";
  }
};

const runMicrosoftBrowserLogin = async (
  ctx: Omit<ScenarioContext, "auth">,
): Promise<MojangSession | null> => {
  const clientId = await resolveClientId(ctx);
  if (clientId === null) return null;
  const spinner = ctx.ui.spinner();
  spinner.start("Preparing Microsoft sign-in…");
  try {
    const session = await ctx.kit.auth.authorizationCode.run({
      clientId,
      onOpenBrowser: async (url) => {
        const opened = await openBrowser(url);
        spinner.stop("Authorize URL ready.");
        ctx.ui.note(
          "Sign in with your Microsoft account",
          [
            opened
              ? "1. Your default browser was opened automatically."
              : "1. Open the following URL in your browser:",
            ...(opened ? [] : ["", url]),
            "",
            "2. Pick the Microsoft account that owns Minecraft: Java Edition.",
            "3. Browser will redirect back to the launcher — you can close the tab.",
          ].join("\n"),
        );
        spinner.start("Waiting for browser sign-in…");
      },
    });
    spinner.stop(`Signed in as ${session.minecraft.username}.`);
    return session;
  } catch (error) {
    spinner.stop("Sign-in failed.");
    ctx.ui.log("error", formatUserError(error));
    return null;
  }
};

const promptOfflineAuth = async (
  ctx: Omit<ScenarioContext, "auth">,
): Promise<OfflineAuth | null> => {
  const usernameOutcome = await ctx.ui.text({
    message: "Player username",
    placeholder: "Player",
    initial: "Player",
    validate: (s) => (s.trim().length === 0 ? "Username must be non-empty" : undefined),
  });
  if (usernameOutcome.kind !== "ok") return null;
  return { mode: AuthModes.OFFLINE, username: usernameOutcome.value.trim() };
};

const printSession = (ctx: Pick<ScenarioContext, "ui">, session: MojangSession): void => {
  const expiresIn = Math.max(0, Math.round((session.minecraft.expiresAt - Date.now()) / 1000 / 60));
  ctx.ui.note(
    "Active Mojang session",
    [
      `Player:       ${session.minecraft.username}`,
      `UUID:         ${session.minecraft.uuid}`,
      `XUID:         ${session.minecraft.xuid || "—"}`,
      `Token expires: in ~${expiresIn} min`,
    ].join("\n"),
  );
};

const resolveClientId = async (
  ctx: Omit<ScenarioContext, "auth">,
): Promise<AzureClientId | null> => {
  const fromEnv = process.env[CLIENT_ID_ENV_VAR];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    try {
      return asAzureClientId(fromEnv);
    } catch (error) {
      if (!isMinecraftKitError(error)) throw error;
      ctx.ui.log("warn", `Ignoring ${CLIENT_ID_ENV_VAR}: ${error.message}`);
    }
  }
  ctx.ui.note(
    "Azure AD client id required",
    [
      "Microsoft sign-in needs an Azure AD application id.",
      `Set ${CLIENT_ID_ENV_VAR} once and re-run, or paste it here.`,
      "Register one at: https://entra.microsoft.com → App registrations.",
      "Audience: Personal Microsoft accounts. Required scope: XboxLive.signin offline_access.",
    ].join("\n"),
  );
  const entered = await ctx.ui.text({
    message: "Paste Azure AD client id (or press Enter to cancel)",
    placeholder: "00000000-0000-0000-0000-000000000000",
    validate: (raw) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return undefined;
      return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        trimmed,
      )
        ? undefined
        : "Expected the 8-4-4-4-12 GUID format";
    },
  });
  if (entered.kind !== "ok") return null;
  const trimmed = entered.value.trim();
  return trimmed.length > 0 ? asAzureClientId(trimmed) : null;
};
