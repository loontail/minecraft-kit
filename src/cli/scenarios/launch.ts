import { AuthModes } from "../../types/auth";
import { formatUserError } from "../error-format";
import { pickInstalledTarget } from "./pickers";
import type { ScenarioContext, ScenarioOutcome } from "./types";

/**
 * Scenario: launch Minecraft from a discovered installation. The active auth is taken from
 * `ctx.auth.current` (populated once at CLI startup) — no prompting here.
 *
 * @internal
 */
export const scenarioLaunch = async (ctx: ScenarioContext): Promise<ScenarioOutcome> => {
  const target = await pickInstalledTarget(ctx);
  if (!target) return "cancelled";
  const auth = ctx.auth.current;
  if (!auth) {
    ctx.ui.log(
      "error",
      "No active account — sign in from the menu or restart the CLI to choose an account.",
    );
    return "cancelled";
  }
  ctx.ui.log(
    "info",
    auth.mode === AuthModes.ONLINE
      ? `Launching as ${auth.username} (Microsoft).`
      : `Launching as ${auth.username} (offline).`,
  );
  try {
    const composition = await ctx.kit.launch.compose(target, { auth });
    ctx.ui.note(
      "Launch summary",
      [
        `Java:       ${composition.javaPath}`,
        `Main class: ${composition.mainClass}`,
        `Classpath:  ${composition.classpath.length} entries`,
        `Natives:    ${composition.nativesDirectory}`,
        `Working:    ${composition.workingDirectory}`,
      ].join("\n"),
    );
    const ok = await ctx.ui.confirm({ message: "Spawn Minecraft now?", initial: true });
    if (ok.kind !== "ok" || !ok.value) return "cancelled";
    const session = ctx.kit.launch.run(composition, {
      onEvent: (event) => {
        if (event.type === "launch:stdout" || event.type === "launch:stderr") {
          ctx.ui.log(event.type === "launch:stderr" ? "warn" : "info", event.line);
        }
      },
    });
    ctx.ui.log("info", `Started PID ${session.pid}. Waiting for exit…`);
    await session.exited;
    ctx.ui.log("success", "Game exited.");
    return "completed";
  } catch (error) {
    ctx.ui.log("error", formatUserError(error));
    return "cancelled";
  }
};
