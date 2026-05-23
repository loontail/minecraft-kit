import { withOptionalSignal } from "../core/optional";
import type { MinecraftProfile } from "../types/auth";
import type { HttpClient } from "../types/http";
import { fetchMinecraftProfile } from "./minecraft";

/**
 * Inputs to {@link readProfile}.
 *
 * @example
 * ```ts
 * import type { ReadProfileInput } from "@loontail/minecraft-kit";
 *
 * const input: ReadProfileInput = { accessToken: session.minecraft.accessToken };
 * ```
 */
export type ReadProfileInput = {
  /** Minecraft bearer (`session.minecraft.accessToken`). */
  readonly accessToken: string;
  readonly signal?: AbortSignal;
};

/**
 * GET `/minecraft/profile` — read the current player profile (uuid + display
 * name + every skin slot Mojang has issued for the account).
 *
 * Use this to cheaply validate a cached Minecraft access token without
 * spending a Microsoft refresh token: a 2xx confirms the token is still
 * usable, while 401/403 surfaces as `AUTH_MINECRAFT_FAILED` (refresh the
 * session and retry) and 404 as `AUTH_NO_GAME_OWNERSHIP`.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const profile = await kit.auth.profile.read({
 *   accessToken: session.minecraft.accessToken,
 * });
 * console.log(profile.username, profile.uuid);
 * ```
 */
export const readProfile = (http: HttpClient, input: ReadProfileInput): Promise<MinecraftProfile> =>
  fetchMinecraftProfile({
    http,
    accessToken: input.accessToken,
    ...withOptionalSignal(input.signal),
  });
