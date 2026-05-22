import type { MinecraftVersionId } from "../types/minecraft";
import { MinecraftKitError, MinecraftKitErrorCodes } from "./errors";

/**
 * Validate `raw` as a Minecraft version id and brand it as
 * {@link MinecraftVersionId}. Throws `MinecraftKitError(INVALID_INPUT)` when
 * the input is empty after trimming. Version ids span vanilla (`"1.20.1"`),
 * snapshot (`"24w14a"`), and loader-flavoured shapes
 * (`"fabric-loader-0.14.21-1.20.1"`, `"1.20.1-forge-47.2.0"`), so the
 * constructor only enforces non-emptiness — the resolver decides whether the
 * id actually corresponds to a published version.
 *
 * @example
 * ```ts
 * import { asMinecraftVersionId } from "@loontail/minecraft-kit";
 *
 * const id = asMinecraftVersionId("1.20.1");
 * await kit.versions.minecraft.resolve({ version: id });
 * ```
 */
export const asMinecraftVersionId = (raw: string): MinecraftVersionId => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      "Minecraft version id cannot be empty.",
    );
  }
  return trimmed as MinecraftVersionId;
};
