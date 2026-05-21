import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { parseJsonOrUndefined } from "../core/json";
import type {
  MojangAssetState,
  MojangProfileCape,
  MojangProfileSkin,
  MojangSkinVariant,
} from "../types/auth";
import type { HttpClient } from "../types/http";
import { authDebug } from "./debug";

const MC_LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";

/** Result of `login_with_xbox` — Minecraft bearer token + lifetime. */
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

type RawProfileSkin = {
  readonly id?: string;
  readonly state?: string;
  readonly url?: string;
  readonly variant?: string;
};

type RawProfileCape = {
  readonly id?: string;
  readonly state?: string;
  readonly url?: string;
  readonly alias?: string;
};

type ProfileResponse = {
  readonly id: string;
  readonly name: string;
  readonly errorMessage?: string;
  readonly skins?: ReadonlyArray<RawProfileSkin>;
  readonly capes?: ReadonlyArray<RawProfileCape>;
};

/** Rich `/minecraft/profile` payload — UUID + display name + all skin/cape slots. */
export type MinecraftProfile = {
  readonly uuid: string;
  readonly username: string;
  readonly skins: ReadonlyArray<MojangProfileSkin>;
  readonly capes: ReadonlyArray<MojangProfileCape>;
};

/** Step 4 — trade the XSTS token for a Minecraft bearer token. */
export const loginWithXbox = async (input: {
  readonly http: HttpClient;
  readonly xstsToken: string;
  readonly userHash: string;
  readonly signal?: AbortSignal;
}): Promise<MinecraftLoginResult> => {
  const body = JSON.stringify({
    identityToken: `XBL3.0 x=${input.userHash};${input.xstsToken}`,
  });
  authDebug(
    `login_with_xbox POST — userHashLen=${input.userHash.length}, xstsTokenLen=${input.xstsToken.length}`,
  );
  const response = await input.http.request(MC_LOGIN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      // Mojang sometimes rejects unknown user-agents on the auth endpoints. Override the
      // library default with a UA that matches what real Minecraft launchers send, so we
      // don't trip an "anomalous client" filter.
      "user-agent": "Minecraft Launcher/2.0 (minecraft-kit)",
    },
    body,
    acceptNonOk: true,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  });
  if (response.status < 200 || response.status >= 300) {
    // Read the response body for diagnostic context. Mojang sometimes returns a JSON
    // payload like `{"error":"FORBIDDEN","errorMessage":"..."}` — much more actionable than
    // a bare status code.
    const rawBody = await response.text().catch(() => "");
    const detail = rawBody.slice(0, 400);
    authDebug(`login_with_xbox failed status=${response.status} body=${detail}`);
    if (response.status === 403) {
      // Mojang ships a "blessed apps" allow-list. New Azure AD client_ids must be approved
      // through https://aka.ms/mce-reviewappid before login_with_xbox accepts them. Catch
      // that specific error message and surface a precise fix.
      if (/invalid app registration/i.test(detail)) {
        throw new MinecraftKitError(
          MinecraftKitErrorCodes.AUTH_MINECRAFT_FAILED,
          `Mojang has not approved this Azure AD application id for the Minecraft API. The OAuth + Xbox/XSTS exchange all succeeded, but api.minecraftservices.com only accepts client_ids that are on its allow-list. Apply at https://aka.ms/mce-reviewappid (Application ID, contact email, purpose) — approval typically takes a few days. Raw response: ${detail}`,
          { context: { httpStatus: 403, body: detail, reason: "invalid_app_registration" } },
        );
      }
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.AUTH_NO_GAME_OWNERSHIP,
        `Mojang refused login_with_xbox (HTTP 403). The Xbox/Microsoft exchange succeeded, but api.minecraftservices.com declined to issue a Minecraft token. Most common causes: (1) you signed in to the browser with a DIFFERENT Microsoft account than the one owning Java Edition — re-check the email on https://www.minecraft.net/profile and make sure it matches what you typed at the device-code page; (2) this account never used Xbox services before — open https://www.xbox.com once with this account, then retry; (3) transient Mojang 5xx/403, just retry in 60s. Raw response: ${detail || "<empty>"}`,
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
 * Step 5 — fetch the player profile using the Minecraft bearer token. Returns the rich
 * payload (UUID + display name + every skin/cape slot Mojang has issued) so callers can
 * drive their skin-picker UI without an extra round-trip.
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
      "user-agent": "Minecraft Launcher/2.0 (minecraft-kit)",
    },
    acceptNonOk: true,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  });
  if (response.status === 404) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_NO_GAME_OWNERSHIP,
      "This Microsoft account does not own Minecraft: Java Edition.",
      { context: { httpStatus: 404 } },
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_MINECRAFT_FAILED,
      `Failed to load Minecraft profile (HTTP ${response.status}).`,
      { context: { httpStatus: response.status } },
    );
  }
  const parsed = (await response.json()) as ProfileResponse;
  if (parsed.errorMessage || !parsed.id || !parsed.name) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_MINECRAFT_FAILED,
      parsed.errorMessage ?? "Minecraft profile response was malformed.",
    );
  }
  return {
    uuid: dashUuid(parsed.id),
    username: parsed.name,
    skins: (parsed.skins ?? []).flatMap(toProfileSkin),
    capes: (parsed.capes ?? []).flatMap(toProfileCape),
  };
};

const ASSET_STATES: ReadonlySet<MojangAssetState> = new Set(["ACTIVE", "INACTIVE"]);
const SKIN_VARIANTS: ReadonlySet<MojangSkinVariant> = new Set(["CLASSIC", "SLIM"]);

// Drop rows whose required fields Mojang omitted. Unknown variants/states are
// rejected rather than coerced — better an empty list than a row that violates
// our union types and corrupts downstream UI assumptions.
const toProfileSkin = (raw: RawProfileSkin): ReadonlyArray<MojangProfileSkin> => {
  if (!raw.id || !raw.url || !raw.state || !raw.variant) return [];
  if (!ASSET_STATES.has(raw.state as MojangAssetState)) return [];
  if (!SKIN_VARIANTS.has(raw.variant as MojangSkinVariant)) return [];
  return [
    {
      id: raw.id,
      url: raw.url,
      state: raw.state as MojangAssetState,
      variant: raw.variant as MojangSkinVariant,
    },
  ];
};

const toProfileCape = (raw: RawProfileCape): ReadonlyArray<MojangProfileCape> => {
  if (!raw.id || !raw.url || !raw.state) return [];
  if (!ASSET_STATES.has(raw.state as MojangAssetState)) return [];
  return [
    {
      id: raw.id,
      url: raw.url,
      state: raw.state as MojangAssetState,
      ...(raw.alias !== undefined ? { alias: raw.alias } : {}),
    },
  ];
};

/**
 * Decode the XUID out of the JWT-shaped Minecraft access token. The token has three base64url
 * segments — we read the middle (payload) one and pluck `xuid`. Errors are non-fatal; we
 * return an empty string so the rest of the flow can still proceed.
 */
export const extractXuid = (accessToken: string): string => {
  const parts = accessToken.split(".");
  const payload = parts[1];
  if (typeof payload !== "string") return "";
  const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8",
  );
  const parsed = parseJsonOrUndefined<{ xuid?: unknown }>(json);
  return typeof parsed?.xuid === "string" ? parsed.xuid : "";
};

/** Convert a dashless UUID (Mojang format) into the dashed canonical form. */
const dashUuid = (raw: string): string => {
  if (raw.includes("-")) return raw;
  if (raw.length !== 32) return raw;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(
    16,
    20,
  )}-${raw.slice(20)}`;
};
