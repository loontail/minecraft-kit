import type { Loaders } from "./loader";
import type { ResolvedMinecraft } from "./minecraft";

/**
 * Trivial loader used when no mod loader is in play. Carries the resolved Minecraft so the
 * launch composer has a uniform view across vanilla / Fabric / Forge.
 */
export type ResolvedVanillaLoader = {
  readonly type: typeof Loaders.VANILLA;
  /** Minecraft version this loader is pinned to. */
  readonly minecraftVersion: string;
  /** The Minecraft manifest used for launch — same as the target's `minecraft.manifest`. */
  readonly minecraft: ResolvedMinecraft;
};
