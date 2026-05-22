import process from "node:process";
import { MinecraftKit } from "../kit";
import { formatUserError } from "./error-format";
import {
  type AuthState,
  type ScenarioContext,
  type ScenarioOutcome,
  pickInitialAuth,
  scenarioInspect,
  scenarioInstallMinecraft,
  scenarioInstallRuntime,
  scenarioLaunch,
  scenarioLogin,
  scenarioRepair,
  scenarioVerify,
} from "./scenarios";
import { type Ui, createClackUi } from "./ui";

const SCENARIO_KEYS = {
  INSTALL_MC: "install-minecraft",
  INSTALL_RUNTIME: "install-runtime",
  VERIFY: "verify",
  REPAIR: "repair",
  LAUNCH: "launch",
  INSPECT: "inspect",
  LOGIN: "login",
  EXIT: "exit",
} as const;

/** Recognised command-line flags. */
const CLI_FLAGS = {
  HELP: ["--help", "-h"],
  VERSION: ["--version", "-v"],
  DEBUG: ["--debug"],
} as const;

/** True when the parsed args array contains any of the given flag aliases. */
const hasFlag = (args: readonly string[], aliases: readonly string[]): boolean =>
  aliases.some((flag) => args.includes(flag));

/**
 * Inputs to {@link runCli}.
 *
 * @internal
 */
export type RunCliInput = {
  readonly args: readonly string[];
  readonly ui: Ui;
  readonly rootDir: string;
  readonly kit?: MinecraftKit;
};

/**
 * Programmatic CLI entrypoint, used by both the bin and the tests.
 *
 * @internal
 */
export const runCli = async (input: RunCliInput): Promise<number> => {
  if (hasFlag(input.args, CLI_FLAGS.HELP)) {
    input.ui.note(
      "mckit — minecraft-kit CLI",
      [
        "Run with no arguments for the interactive menu.",
        "",
        "Flags:",
        "  --help, -h     Show this help.",
        "  --version, -v  Print the kit version.",
        "  --debug        Print raw stack traces from scenario crashes instead of the",
        "                 friendly formatUserError translation. Useful for bug reports.",
      ].join("\n"),
    );
    return 0;
  }
  if (hasFlag(input.args, CLI_FLAGS.VERSION)) {
    input.ui.log("info", __PKG_VERSION__);
    return 0;
  }
  const debug = hasFlag(input.args, CLI_FLAGS.DEBUG);
  const kit = input.kit ?? new MinecraftKit();
  const auth: AuthState = { current: null, microsoftSession: null };
  input.ui.intro("mckit — Minecraft launcher kit");
  const signedIn = await pickInitialAuth({ kit, ui: input.ui, rootDir: input.rootDir }, auth);
  if (!signedIn) {
    input.ui.outro("Goodbye.");
    return 0;
  }
  const ctx: ScenarioContext = { kit, ui: input.ui, rootDir: input.rootDir, auth };
  while (true) {
    const choice = await input.ui.select<string>({
      message: "What would you like to do?",
      options: MAIN_MENU,
    });
    if (choice.kind !== "ok" || choice.value === SCENARIO_KEYS.EXIT) {
      input.ui.outro("Goodbye.");
      return 0;
    }
    try {
      const outcome = await dispatch(choice.value, ctx);
      if (outcome === "cancelled") {
        input.ui.log("info", "Operation cancelled.");
      }
    } catch (error) {
      if (debug) {
        input.ui.log("error", `${error instanceof Error ? error.stack : String(error)}`);
      } else {
        input.ui.log("error", formatUserError(error));
      }
    }
  }
};

/**
 * Main-menu options exported so tests can assert their composition.
 *
 * @internal
 */
export const MAIN_MENU: ReadonlyArray<{ label: string; value: string; hint?: string }> = [
  { label: "Install Minecraft", value: SCENARIO_KEYS.INSTALL_MC, hint: "Vanilla / Fabric / Forge" },
  { label: "Install Java/runtime", value: SCENARIO_KEYS.INSTALL_RUNTIME },
  { label: "Verify installation", value: SCENARIO_KEYS.VERIFY },
  { label: "Repair installation", value: SCENARIO_KEYS.REPAIR },
  { label: "Launch Minecraft", value: SCENARIO_KEYS.LAUNCH },
  { label: "Inspect installation", value: SCENARIO_KEYS.INSPECT },
  {
    label: "Account…",
    value: SCENARIO_KEYS.LOGIN,
    hint: "View session, refresh, switch, or sign out",
  },
  { label: "Exit", value: SCENARIO_KEYS.EXIT },
];

const dispatch = async (choice: string, ctx: ScenarioContext): Promise<ScenarioOutcome> => {
  switch (choice) {
    case SCENARIO_KEYS.INSTALL_MC:
      return scenarioInstallMinecraft(ctx);
    case SCENARIO_KEYS.INSTALL_RUNTIME:
      return scenarioInstallRuntime(ctx);
    case SCENARIO_KEYS.VERIFY:
      return scenarioVerify(ctx);
    case SCENARIO_KEYS.REPAIR:
      return scenarioRepair(ctx);
    case SCENARIO_KEYS.LAUNCH:
      return scenarioLaunch(ctx);
    case SCENARIO_KEYS.INSPECT:
      return scenarioInspect(ctx);
    case SCENARIO_KEYS.LOGIN:
      return scenarioLogin(ctx);
    default:
      ctx.ui.log("warn", `Unknown action: ${choice}`);
      return "cancelled";
  }
};

/**
 * Bin entrypoint.
 *
 * @internal
 */
export const bin = async (): Promise<void> => {
  const ui = await createClackUi();
  const code = await runCli({
    args: process.argv.slice(2),
    ui,
    rootDir: process.cwd(),
  });
  process.exit(code);
};
