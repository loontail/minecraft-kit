/**
 * Post-Microsoft-token auth pipeline. Given a Microsoft access token (obtained either via
 * Authorization Code + PKCE or via a refresh-token exchange), runs the four upstream calls
 * — XBL → XSTS → `login_with_xbox` → `/minecraft/profile` — and assembles a
 * {@link MojangSession}. The flow is identical for the interactive and the refresh paths;
 * factoring it out keeps the {@link "./index"} facade focused on the two entry-point
 * scenarios rather than token-exchange plumbing.
 *
 * @internal
 * @packageDocumentation
 */

import { withOptionalSignal } from "../core/optional";
import type { AzureClientId, MojangSession } from "../types/auth";
import type { HttpClient } from "../types/http";
import type { Logger } from "../types/logger";
import type { MicrosoftToken } from "./microsoftToken";
import { extractXuid, fetchMinecraftProfile, loginWithXbox } from "./minecraft";
import { authenticateXbl, authenticateXsts } from "./xbox";

/**
 * Inputs to {@link exchangeMicrosoftToMojang}.
 *
 * @internal
 */
export type ExchangeMicrosoftToMojangInput = {
  readonly http: HttpClient;
  readonly microsoftToken: MicrosoftToken;
  readonly clientId: AzureClientId;
  readonly logger: Logger;
  readonly signal?: AbortSignal;
};

/**
 * Run the Xbox Live → XSTS → Minecraft → profile sequence and return a
 * {@link MojangSession}. The caller has already obtained a Microsoft access token; this
 * function never talks to `login.microsoftonline.com` itself.
 *
 * Errors throw `MinecraftKitError(AUTH_XBOX_FAILED | AUTH_XSTS_FAILED |
 * AUTH_MINECRAFT_FAILED | AUTH_NO_GAME_OWNERSHIP | AUTH_CANCELLED)` from the per-step
 * helpers — this orchestrator does not catch them.
 *
 * @internal
 */
export const exchangeMicrosoftToMojang = async (
  input: ExchangeMicrosoftToMojangInput,
): Promise<MojangSession> => {
  const { http, microsoftToken, clientId, logger, signal } = input;
  const xbl = await authenticateXbl({
    http,
    accessToken: microsoftToken.accessToken,
    logger,
    ...withOptionalSignal(signal),
  });
  const xsts = await authenticateXsts({
    http,
    xblToken: xbl.token,
    logger,
    ...withOptionalSignal(signal),
  });
  const mc = await loginWithXbox({
    http,
    xstsToken: xsts.token,
    userHash: xsts.userHash,
    logger,
    ...withOptionalSignal(signal),
  });
  const profile = await fetchMinecraftProfile({
    http,
    accessToken: mc.accessToken,
    ...withOptionalSignal(signal),
  });

  return {
    minecraft: {
      username: profile.username,
      uuid: profile.uuid,
      accessToken: mc.accessToken,
      expiresAt: Date.now() + mc.expiresIn * 1000,
      xuid: extractXuid(mc.accessToken),
      skins: profile.skins,
    },
    microsoft: {
      refreshToken: microsoftToken.refreshToken,
      clientId,
    },
  };
};
