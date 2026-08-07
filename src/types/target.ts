import type { Loader, LoaderKind } from "./loader";
import type { ResolvedMinecraft } from "./minecraft";
import type { ResolvedRuntime } from "./runtime";

/**
 * Fully resolved target: a concrete Minecraft + loader + runtime + directory.
 *
 * The library never persists a target — consumers are responsible for storing/recreating
 * it. `kit.targets.create` produces a Target from already-resolved components;
 * `kit.targets.resolve` resolves them in one go.
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
 */
export type DiscoveredLoaderHint = {
  readonly type: LoaderKind;
  readonly minecraftVersion?: string;
  readonly version?: string;
};

/**
 * Detected runtime files.
 */
export type DiscoveredRuntimeHint = {
  readonly component?: string;
  readonly javaPath?: string;
  readonly javaVersion?: string;
};
