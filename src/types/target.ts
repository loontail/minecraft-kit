import type { Loader, LoaderKind } from "./loader";
import type { ResolvedMinecraft } from "./minecraft";
import type { ResolvedRuntime } from "./runtime";

/**
 * Fully resolved target: a concrete Minecraft + loader + runtime + directory.
 *
 * The library never persists a target — consumers are responsible for storing/recreating
 * it. `kit.targets.create` produces a Target from already-resolved components;
 * `kit.targets.resolve` resolves them in one go.
 *
 * @example
 * ```ts
 * import { Loaders, type Target } from "@loontail/minecraft-kit";
 *
 * const target: Target = await kit.targets.resolve({
 *   id: "vanilla-1.20.1",
 *   directory: "/games/vanilla",
 *   minecraft: { version: "1.20.1" },
 *   loader: { type: Loaders.VANILLA },
 * });
 * ```
 */
export type Target = {
  /** Stable identifier chosen by the consumer. Used for diagnostics, not persistence. */
  readonly id: string;
  /** Absolute or relative path to the per-target Minecraft directory. */
  readonly directory: string;
  readonly minecraft: ResolvedMinecraft;
  readonly loader: Loader;
  readonly runtime: ResolvedRuntime;
};

/**
 * Inputs accepted by `kit.targets.create`.
 *
 * @example
 * ```ts
 * import { detectSystem, type TargetCreateInput } from "@loontail/minecraft-kit";
 *
 * const minecraft = await kit.versions.minecraft.resolve({ version: "1.20.1" });
 * const runtime = await kit.versions.runtime.resolve({ system: detectSystem() });
 * const input: TargetCreateInput = {
 *   id: "vanilla-1.20.1",
 *   directory: "/games/vanilla",
 *   minecraft,
 *   loader: { type: "vanilla", minecraftVersion: "1.20.1", minecraft },
 *   runtime,
 * };
 * const target = kit.targets.create(input);
 * ```
 */
export type TargetCreateInput = {
  readonly id: string;
  readonly directory: string;
  readonly minecraft: ResolvedMinecraft;
  readonly loader: Loader;
  readonly runtime: ResolvedRuntime;
};

/**
 * Discovered installation found by scanning a root directory. Contains only what was
 * actually read from disk — no assumptions about correctness, completeness, or repair state.
 *
 * @example
 * ```ts
 * import type { DiscoveredTarget } from "@loontail/minecraft-kit";
 *
 * const installs: readonly DiscoveredTarget[] = await kit.targets.list({ rootDir: "/games" });
 * for (const i of installs) console.log(i.id, i.minecraftVersions, i.loaders.length);
 * ```
 */
export type DiscoveredTarget = {
  /** Subdirectory name under the scanned root. */
  readonly id: string;
  /** Absolute or normalized directory path. */
  readonly directory: string;
  /** Minecraft version ids found under `versions/`. */
  readonly minecraftVersions: readonly string[];
  /** Loader entries inferred from version-name conventions. */
  readonly loaders: readonly DiscoveredLoaderHint[];
  /** Detected Java executable, when one is present in the per-target `runtime/` folder. */
  readonly runtime?: DiscoveredRuntimeHint;
};

/**
 * Inferred loader hint (does not assert correctness).
 *
 * @example
 * ```ts
 * import { Loaders, type DiscoveredLoaderHint } from "@loontail/minecraft-kit";
 *
 * const fabricHints = (hints: readonly DiscoveredLoaderHint[]) =>
 *   hints.filter((h) => h.type === Loaders.FABRIC);
 * ```
 */
export type DiscoveredLoaderHint = {
  readonly type: LoaderKind;
  readonly minecraftVersion?: string;
  readonly version?: string;
};

/**
 * Detected runtime files.
 *
 * @example
 * ```ts
 * import type { DiscoveredRuntimeHint } from "@loontail/minecraft-kit";
 *
 * const hint: DiscoveredRuntimeHint | undefined = discoveredTarget.runtime;
 * if (hint?.javaPath) console.log(`reusing java: ${hint.javaPath}`);
 * ```
 */
export type DiscoveredRuntimeHint = {
  readonly component?: string;
  readonly javaPath?: string;
  readonly javaVersion?: string;
};
