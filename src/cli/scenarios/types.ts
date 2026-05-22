import type { MinecraftKit } from "../../kit";
import type { MojangSession, OfflineAuth, OnlineAuth } from "../../types/auth";
import type { Loaders } from "../../types/loader";
import {
  type MinecraftChannel,
  MinecraftChannels,
  type MinecraftVersionSummary,
} from "../../types/minecraft";
import type { SelectOption, Ui } from "../ui";

/**
 * Active session for the CLI, modelled as a discriminated union so the
 * "online ⇒ session present" invariant lives in the type instead of in
 * paired-field guards.
 *
 * @internal
 */
export type AuthState =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "offline"; readonly auth: OfflineAuth }
  | { readonly kind: "online"; readonly auth: OnlineAuth; readonly session: MojangSession };

/**
 * Mutable holder for the active {@link AuthState}, shared by every scenario.
 * Scenarios that change auth (the login menu) reassign `state`; everyone else
 * reads a snapshot.
 *
 * @internal
 */
export type AuthRef = { state: AuthState };

/**
 * Inputs every scenario receives.
 *
 * @internal
 */
export type ScenarioContext = {
  readonly kit: MinecraftKit;
  readonly ui: Ui;
  readonly rootDir: string;
  readonly auth: AuthRef;
};

/**
 * Outcome of a scenario — whether the user cancelled or completed.
 *
 * @internal
 */
export type ScenarioOutcome = "completed" | "cancelled";

/**
 * Loader kind selectable during the install wizard.
 *
 * @internal
 */
export type InstallType = typeof Loaders.VANILLA | typeof Loaders.FABRIC | typeof Loaders.FORGE;

/**
 * Selection state collected by the install wizard.
 *
 * @internal
 */
export type InstallSelection = {
  channel: MinecraftChannel | "old" | "all" | null;
  version: MinecraftVersionSummary | null;
  runtimeOverride: string | null;
  installType: InstallType | null;
  fabricLoader: string | null;
  forgeBuild: string | null;
  forgeLabel: string | null;
  directory: string | null;
};

/**
 * Channel picker options. Defined once so tests and the picker share the source.
 *
 * @internal
 */
export const CHANNEL_OPTIONS: readonly SelectOption<MinecraftChannel | "old" | "all">[] = [
  { label: "Release", value: MinecraftChannels.RELEASE, hint: "stable releases (recommended)" },
  { label: "Snapshot", value: MinecraftChannels.SNAPSHOT, hint: "weekly development builds" },
  { label: "Old versions", value: "old", hint: "old_beta + old_alpha" },
  { label: "All", value: "all", hint: "every channel combined" },
];

/**
 * Named steps of the install-minecraft wizard state machine.
 *
 * @internal
 */
export const InstallWizardSteps = {
  CHANNEL: "channel",
  VERSION: "version",
  RUNTIME: "runtime",
  INSTALL_TYPE: "install-type",
  FABRIC_LOADER: "fabric-loader",
  FORGE_BUILD: "forge-build",
  DIRECTORY: "directory",
  SUMMARY: "summary",
} as const;

/** @internal */
export type InstallWizardStep = (typeof InstallWizardSteps)[keyof typeof InstallWizardSteps];

/**
 * Outcome of `runInstallFromSelection` (from `./install-helpers`).
 *
 * @internal
 */
export const InstallRunResults = {
  OK: "ok",
  CANCELLED: "cancelled",
  /** Target resolution failed; the wizard should bounce back to the loader-choice step. */
  INSTALL_TYPE: InstallWizardSteps.INSTALL_TYPE,
} as const;

/** @internal */
export type InstallRunResult = (typeof InstallRunResults)[keyof typeof InstallRunResults];
