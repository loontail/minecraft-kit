/**
 * Authentication modes accepted by the launch composer.
 */
export const AuthModes = {
  /** Offline-mode play with a chosen username and synthetic UUID. */
  OFFLINE: "offline",
  /** Pre-authenticated session — caller provides the access token and identity. */
  ONLINE: "online",
} as const;

/**
 * Auth mode literal.
 */
export type AuthMode = (typeof AuthModes)[keyof typeof AuthModes];

/**
 * Branded Azure AD application id. Construct via `asAzureClientId` (exported from
 * the package root) — the brand prevents accidentally passing a refresh token or
 * a UUID where the kit expects a client id.
 */
export type AzureClientId = string & { readonly __brand: "AzureClientId" };

/**
 * Branded Microsoft refresh token. Construct via `asMicrosoftRefreshToken`
 * (exported from the package root) — the brand prevents accidentally passing
 * an access token, XSTS token, or another opaque string where a Microsoft
 * refresh token is expected.
 */
export type MicrosoftRefreshToken = string & { readonly __brand: "MicrosoftRefreshToken" };

/**
 * Branded Minecraft player UUID. Construct via `asPlayerUuid` (exported from
 * the package root) — the brand prevents accidentally passing a Minecraft
 * version id, an Xbox userhash, or another opaque string where the launch
 * composer expects a player UUID.
 *
 * `offlineUuidFor` already returns this brand; reach for `asPlayerUuid` when
 * loading a saved UUID from disk or when the host environment supplies one.
 */
export type PlayerUuid = string & { readonly __brand: "PlayerUuid" };

/**
 * Offline authentication.
 */
export type OfflineAuth = {
  readonly mode: typeof AuthModes.OFFLINE;
  readonly username: string;
  /** Optional explicit UUID. When omitted, a deterministic UUID is derived from the username. */
  readonly uuid?: PlayerUuid;
};

/**
 * Online (token-based) authentication.
 *
 * Build via {@link toOnlineAuth} from a {@link MojangSession}; rarely constructed directly.
 *
 * `clientId` and `xuid` are Microsoft-specific and optional: a launcher whose accounts come
 * from its own auth service (Yggdrasil and friends) has no Azure application id and no XUID.
 * Omit them rather than inventing a value — the launch placeholders resolve an absent field to
 * the empty string, which is exactly what the offline path already passes.
 */
export type OnlineAuth = {
  readonly mode: typeof AuthModes.ONLINE;
  readonly username: string;
  readonly uuid: PlayerUuid;
  readonly accessToken: string;
  readonly userType: string;
  readonly clientId?: AzureClientId;
  readonly xuid?: string;
};

/**
 * Auth shape consumed by `kit.launch.compose`. Either an {@link OfflineAuth} or {@link OnlineAuth}.
 */
export type LaunchAuth = OfflineAuth | OnlineAuth;

/**
 * Lifecycle state of a Mojang-issued skin slot.
 */
export const MojangAssetStates = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
} as const;

export type MojangAssetState = (typeof MojangAssetStates)[keyof typeof MojangAssetStates];

/**
 * Skin model variant — `"CLASSIC"` for standard 4-pixel arms (Steve) or
 * `"SLIM"` for 3-pixel arms (Alex).
 */
export const SkinVariants = {
  CLASSIC: "CLASSIC",
  SLIM: "SLIM",
} as const;

export type SkinVariant = (typeof SkinVariants)[keyof typeof SkinVariants];

/**
 * A single skin slot returned by `/minecraft/profile`.
 */
export type MojangProfileSkin = {
  readonly id: string;
  readonly state: MojangAssetState;
  readonly url: string;
  readonly variant: SkinVariant;
};

/**
 * Snapshot of `/minecraft/profile` — uuid + display name + every skin slot
 * Mojang has issued. Returned by every `kit.auth.profile.*` mutation so
 * callers can refresh their UI without an extra round-trip.
 */
export type MinecraftProfile = {
  readonly uuid: PlayerUuid;
  readonly username: string;
  readonly skins: ReadonlyArray<MojangProfileSkin>;
};

/**
 * Combined Microsoft + Minecraft session returned by
 * `kit.auth.authorizationCode.run` and `kit.auth.refresh`.
 *
 * The fields under `minecraft` are everything {@link OnlineAuth} needs plus the
 * raw `/minecraft/profile` payload so callers do not have to re-fetch it for skin/cape UI.
 * The fields under `microsoft` are needed only to refresh the session later —
 * persist them to durable storage (encrypted) alongside the user's profile.
 */
export type MojangSession = {
  readonly minecraft: {
    /** Player display name. */
    readonly username: string;
    /** Player UUID, dashed (e.g. `f81d4fae-7dec-11d0-a765-00a0c91e6bf6`). */
    readonly uuid: PlayerUuid;
    /** Bearer token for `api.minecraftservices.com` and the game itself. */
    readonly accessToken: string;
    /** Wall-clock ms timestamp when {@link accessToken} expires. */
    readonly expiresAt: number;
    /** Xbox User ID (XUID) as a numeric string. */
    readonly xuid: string;
    /** Every skin slot Mojang has issued for the user (active + inactive). */
    readonly skins: ReadonlyArray<MojangProfileSkin>;
  };
  readonly microsoft: {
    /** Microsoft refresh token; used to obtain a fresh session without re-prompting. */
    readonly refreshToken: MicrosoftRefreshToken;
    /** Azure AD application id used to mint the session. */
    readonly clientId: AzureClientId;
  };
};
