import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { isMojangProfileSkin } from "../core/guards";
import { parseJsonOrUndefined } from "../core/json";
import { withOptionalSignal } from "../core/optional";
import { addUuidDashes, asPlayerUuid } from "../core/uuid";
import { isHttpOk } from "../http/status";
import type { MinecraftProfile } from "../types/auth";
import type { HttpClient } from "../types/http";
import type { Logger } from "../types/logger";

const MC_LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";

/**
 * User-Agent sent to `api.minecraftservices.com`. Mojang silently filters
 * unknown/non-launcher UAs on the auth endpoints with a 403 + opaque body,
 * so we send a string that matches what real Minecraft launchers use.
 *
 * @internal
 */
export const MINECRAFT_KIT_USER_AGENT = "Minecraft Launcher/2.0 (minecraft-kit)";

/**
 * Shape of every successful `/minecraft/profile` response (`GET` plus every
 * mutation endpoint). Exported so {@link parseProfileResponse} can be reused
 * outside this module.
 *
 * @internal
 */
export type RawProfileResponse = {
  readonly id: string;
  readonly name: string;
  readonly errorMessage?: string;
  readonly skins?: ReadonlyArray<unknown>;
};

/**
 * Parse a `/minecraft/profile` JSON body into {@link MinecraftProfile}. Throws
 * `AUTH_MINECRAFT_FAILED` when Mojang returns `{errorMessage}` or when the
 * required fields (`id`, `name`) are missing.
 *
 * @internal
 */
export const parseProfileResponse = (parsed: RawProfileResponse): MinecraftProfile => {
  if (parsed.errorMessage || !parsed.id || !parsed.name) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_MINECRAFT_FAILED,
      parsed.errorMessage ?? "Minecraft profile response was malformed.",
    );
  }
  return {
    uuid: asPlayerUuid(addUuidDashes(parsed.id)),
    username: parsed.name,
    skins: (parsed.skins ?? []).filter(isMojangProfileSkin),
  };
};

/**
 * Result of `login_with_xbox` — Minecraft bearer token + lifetime.
 *
 * @internal
 */
export type MinecraftLoginResult = {
  readonly accessToken: string;
  readonly expiresIn: number;
};

type LoginResponse = {
  readonly access_token: string;
  readonly expires_in: number;
  /** Claims JWT carrying the XUID (`xuid`) — opaque to us; we extract via `parseXuid`. */
  readonly username?: string;
};

/**
 * Step 4 — trade the XSTS token for a Minecraft bearer token.
 *
 * @internal
 */
export const loginWithXbox = async (input: {
  readonly http: HttpClient;
  readonly xstsToken: string;
  readonly userHash: string;
  readonly signal?: AbortSignal;
  readonly logger?: Logger;
}): Promise<MinecraftLoginResult> => {
  const body = JSON.stringify({
    identityToken: `XBL3.0 x=${input.userHash};${input.xstsToken}`,
  });
  input.logger?.log(
    "debug",
    `login_with_xbox POST — userHashLen=${input.userHash.length}, xstsTokenLen=${input.xstsToken.length}`,
  );
  const response = await input.http.request(MC_LOGIN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": MINECRAFT_KIT_USER_AGENT,
    },
    body,
    acceptNonOk: true,
    ...withOptionalSignal(input.signal),
  });
  if (!isHttpOk(response.status)) {
    const rawBody = await response.text().catch(() => "");
    const detail = rawBody.slice(0, 400);
    input.logger?.log("debug", `login_with_xbox failed status=${response.status} body=${detail}`);
    if (response.status === 403) {
      if (is403InvalidAppReg(detail)) {
        throw new MinecraftKitError(
          MinecraftKitErrorCodes.AUTH_MINECRAFT_FAILED,
          `Mojang has not approved this Azure AD application id for the Minecraft API. The OAuth + Xbox/XSTS exchange all succeeded, but api.minecraftservices.com only accepts client_ids that are on its allow-list. Apply at https://aka.ms/mce-reviewappid (Application ID, contact email, purpose) — approval typically takes a few days. Raw response: ${detail}`,
          { context: { httpStatus: 403, body: detail, reason: "invalid_app_registration" } },
        );
      }
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.AUTH_NO_GAME_OWNERSHIP,
        `Mojang refused login_with_xbox (HTTP 403). The Xbox/Microsoft exchange succeeded, but api.minecraftservices.com declined to issue a Minecraft token. Most common causes: (1) you signed in to the browser with a DIFFERENT Microsoft account than the one owning Java Edition — re-check the email on https://www.minecraft.net/profile and make sure it matches the account you signed in with in the browser; (2) this account never used Xbox services before — open https://www.xbox.com once with this account, then retry; (3) transient Mojang 5xx/403, just retry in 60s. Raw response: ${detail || "<empty>"}`,
        { context: { httpStatus: 403, body: detail } },
      );
    }
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_MINECRAFT_FAILED,
      `Minecraft sign-in failed with HTTP ${response.status}. Response: ${detail || "<empty>"}`,
      { context: { httpStatus: response.status, body: detail } },
    );
  }
  const parsed = (await response.json()) as LoginResponse;
  if (!parsed.access_token) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_MINECRAFT_FAILED,
      "Minecraft sign-in returned no access token.",
    );
  }
  return { accessToken: parsed.access_token, expiresIn: parsed.expires_in };
};

/**
 * Detect Mojang's "blessed apps" allow-list failure mode. New Azure AD
 * client_ids must be approved through https://aka.ms/mce-reviewappid before
 * `login_with_xbox` accepts them; until they are, Mojang returns 403 with the
 * literal phrase "invalid app registration" in the body.
 *
 * @internal
 */
const is403InvalidAppReg = (body: string): boolean => /invalid app registration/i.test(body);

/**
 * Step 5 — fetch the player profile using the Minecraft bearer token. Returns the rich
 * payload (UUID + display name + every skin/cape slot Mojang has issued) so callers can
 * drive their skin-picker UI without an extra round-trip.
 *
 * @internal
 */
export const fetchMinecraftProfile = async (input: {
  readonly http: HttpClient;
  readonly accessToken: string;
  readonly signal?: AbortSignal;
}): Promise<MinecraftProfile> => {
  const response = await input.http.request(MC_PROFILE_URL, {
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      accept: "application/json",
      "user-agent": MINECRAFT_KIT_USER_AGENT,
    },
    acceptNonOk: true,
    ...withOptionalSignal(input.signal),
  });
  if (response.status === 404) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_NO_GAME_OWNERSHIP,
      "This Microsoft account does not own Minecraft: Java Edition.",
      { context: { httpStatus: 404 } },
    );
  }
  if (!isHttpOk(response.status)) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_MINECRAFT_FAILED,
      `Failed to load Minecraft profile (HTTP ${response.status}).`,
      { context: { httpStatus: response.status } },
    );
  }
  const parsed = (await response.json()) as RawProfileResponse;
  return parseProfileResponse(parsed);
};

/**
 * Decode the XUID out of the JWT-shaped Minecraft access token. The token has three base64url
 * segments — we read the middle (payload) one and pluck `xuid`. Errors are non-fatal; we
 * return an empty string so the rest of the flow can still proceed.
 *
 * @internal
 */
export const extractXuid = (accessToken: string): string => {
  const [, payload] = accessToken.split(".");
  if (payload === undefined) return "";
  const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8",
  );
  const parsed = parseJsonOrUndefined<{ xuid?: unknown }>(json);
  return typeof parsed?.xuid === "string" ? parsed.xuid : "";
};
