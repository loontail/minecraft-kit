import { withOptionalSignal } from "../core/optional";
import type { MetadataCache } from "../types/cache";
import type { HttpClient } from "../types/http";
import type { InstallAction, InstallPlan, RuntimeOnlyInstallTarget } from "../types/install";
import type { ResolvedRuntime } from "../types/runtime";
import type { Target } from "../types/target";
import { planRuntimeDownloads } from "./runtime";

/**
 * Inputs to {@link planRuntimeInstall}. Same `{ target, http, cache, signal? }` shape the
 * kit wraps for `kit.install.runtime.plan(target, opts)`. Consumers calling the standalone
 * helper can write the shape inline or recover it via
 * `Parameters<typeof planRuntimeInstall>[0]`.
 *
 * @internal
 */
export type PlanRuntimeInstallInput = {
  readonly target: Target;
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly signal?: AbortSignal;
};

/**
 * Build an install plan that downloads ONLY the Java runtime declared by `target.runtime`.
 *
 * Useful when the consumer wants to provision a JRE without touching the rest of the
 * Minecraft installation (no client jar, no libraries, no assets). When `target.runtime.installRoot`
 * is set the runtime files land in a shared global location instead of the per-target folder.
 *
 * The returned plan is a regular {@link InstallPlan}, so it can be passed to the existing
 * install runner — directory placeholders and symlinks declared by the runtime manifest are
 * still materialized after downloads complete.
 *
 * Prefer `kit.install.runtime.plan(target)` over importing this directly.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const plan = await kit.install.runtime.plan(target);
 * await kit.install.runtime.run(plan);
 * ```
 */
export const planRuntimeInstall = async (input: PlanRuntimeInstallInput): Promise<InstallPlan> => {
  const runtimePlan = await planRuntimeDownloads({
    runtime: input.target.runtime,
    directory: input.target.directory,
    http: input.http,
    cache: input.cache,
    ...withOptionalSignal(input.signal),
  });
  const actions: readonly InstallAction[] = runtimePlan.actions;
  const totalBytes = runtimePlan.actions.reduce(
    (sum, action) => sum + (action.expectedSize ?? 0),
    0,
  );
  return {
    targetId: input.target.id,
    directory: input.target.directory,
    target: input.target,
    actions,
    totalActions: actions.length,
    totalBytes,
  };
};

/**
 * Inputs to {@link planStandaloneRuntimeInstall}.
 *
 * @example
 * ```ts
 * import { detectSystem, MinecraftKit, type PlanStandaloneRuntimeInstallInput } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const runtime = await kit.versions.runtime.resolve({ system: detectSystem() });
 * const input: Omit<PlanStandaloneRuntimeInstallInput, "http" | "cache"> = {
 *   id: "shared-jre-21",
 *   directory: "/opt/minecraft/runtimes",
 *   runtime,
 * };
 * const plan = await kit.install.runtime.standalonePlan(input);
 * ```
 */
export type PlanStandaloneRuntimeInstallInput = {
  readonly id: string;
  /** Where the runtime files live. Used as `directory` if `runtime.installRoot` is unset. */
  readonly directory: string;
  readonly runtime: ResolvedRuntime;
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly signal?: AbortSignal;
};

/**
 * Plan a runtime-only install **without a Minecraft target**. Useful for "Install Java/runtime"
 * flows where the user just wants a JRE on disk and never had a Minecraft version to choose
 * from. The returned plan is shaped exactly like a normal {@link InstallPlan} but uses a
 * {@link RuntimeOnlyInstallTarget} that carries only the runtime + directory — the runner skips
 * Minecraft/loader-specific stages because they have no actions in this plan.
 *
 * Prefer `kit.install.runtime.standalonePlan(input)` over importing this directly.
 *
 * @example
 * ```ts
 * import { detectSystem, MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const runtime = await kit.versions.runtime.resolve({ system: detectSystem() });
 * const plan = await kit.install.runtime.standalonePlan({
 *   id: "shared-jre-21",
 *   directory: "/opt/minecraft/runtimes",
 *   runtime,
 * });
 * await kit.install.runtime.run(plan);
 * ```
 */
export const planStandaloneRuntimeInstall = async (
  input: PlanStandaloneRuntimeInstallInput,
): Promise<InstallPlan> => {
  const runtimePlan = await planRuntimeDownloads({
    runtime: input.runtime,
    directory: input.directory,
    http: input.http,
    cache: input.cache,
    ...withOptionalSignal(input.signal),
  });
  const actions: readonly InstallAction[] = runtimePlan.actions;
  const totalBytes = runtimePlan.actions.reduce(
    (sum, action) => sum + (action.expectedSize ?? 0),
    0,
  );
  const target: RuntimeOnlyInstallTarget = {
    id: input.id,
    directory: input.directory,
    runtime: input.runtime,
  };
  return {
    targetId: input.id,
    directory: input.directory,
    target,
    actions,
    totalActions: actions.length,
    totalBytes,
  };
};
