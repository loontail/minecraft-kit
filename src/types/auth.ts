/**
 * Authentication modes accepted by the launch composer.
 *
 * @example
 * ```ts
 * import { AuthModes, type LaunchAuth } from "@loontail/minecraft-kit";
 *
 * const auth: LaunchAuth = { mode: AuthModes.OFFLINE, username: "Steve" };
 * ```
 */
export const AuthModes = {
  /** Offline-mode play with a chosen username and synthetic UUID. */
  OFFLINE: "offline",
  /** Pre-authenticated session — caller provides the access token and identity. */
  ONLINE: "online",
} as const;

/**
 * Auth mode literal.
 *
 * @example
 * ```ts
 * import { AuthModes, type AuthMode } from "@loontail/minecraft-kit";
 *
 * function label(mode: AuthMode): string {
 *   return mode === AuthModes.OFFLINE ? "Offline play" : "Microsoft sign-in";
 * }
 * ```
 */
export type AuthMode = (typeof AuthModes)[keyof typeof AuthModes];

/**
 * Branded Azure AD application id. Construct via `asAzureClientId` (exported from
 * the package root) — the brand prevents accidentally passing a refresh token or
 * a UUID where the kit expects a client id.
 *
 * @example
 * ```ts
 * import { asAzureClientId, type AzureClientId } from "@loontail/minecraft-kit";
 *
 * const clientId: AzureClientId = asAzureClientId(process.env.MSA_CLIENT_ID ?? "");
 * await kit.auth.authorizationCode.run({ clientId, onOpenBrowser });
 * ```
 */
export type AzureClientId = string & { readonly __brand: "AzureClientId" };

/**
 * Offline authentication.
 *
 * @example
 * ```ts
 * import { AuthModes, offlineUuidFor, type OfflineAuth } from "@loontail/minecraft-kit";
 *
 * const auth: OfflineAuth = {
 *   mode: AuthModes.OFFLINE,
 *   username: "Steve",
 *   uuid: offlineUuidFor("Steve"),
 * };
 * ```
 */
export type OfflineAuth = {
  readonly mode: typeof AuthModes.OFFLINE;
  readonly username: string;
  /** Optional explicit UUID. When omitted, a deterministic UUID is derived from the username. */
  readonly uuid?: string;
};

/**
 * Online (token-based) authentication.
 *
 * Build via {@link toOnlineAuth} from a {@link MojangSession}; rarely constructed directly.
 *
 * @example
 * ```ts
 * import { AuthModes, type OnlineAuth } from "@loontail/minecraft-kit";
 *
 * const auth: OnlineAuth = {
 *   mode: AuthModes.ONLINE,
 *   username: session.minecraft.username,
 *   uuid: session.minecraft.uuid,
 *   accessToken: session.minecraft.accessToken,
 *   userType: "msa",
 *   clientId: session.microsoft.clientId,
 *   xuid: session.minecraft.xuid,
 * };
 * ```
 */
export type OnlineAuth = {
  readonly mode: typeof AuthModes.ONLINE;
  readonly username: string;
  readonly uuid: string;
  readonly accessToken: string;
  readonly userType: string;
  readonly clientId: AzureClientId;
  readonly xuid: string;
};

/**
 * Auth shape consumed by `kit.launch.compose`. Either an {@link OfflineAuth} or {@link OnlineAuth}.
 *
 * @example
 * ```ts
 * import { AuthModes, toOnlineAuth, type LaunchAuth } from "@loontail/minecraft-kit";
 *
 * const auth: LaunchAuth = session
 *   ? toOnlineAuth(session)
 *   : { mode: AuthModes.OFFLINE, username: "Steve" };
 * await kit.launch.compose(target, { auth });
 * ```
 */
export type LaunchAuth = OfflineAuth | OnlineAuth;

/**
 * Lifecycle state of a Mojang-issued skin or cape.
 *
 * @example
 * ```ts
 * import type { MojangAssetState, MojangProfileSkin } from "@loontail/minecraft-kit";
 *
 * const activeSkins = (skins: readonly MojangProfileSkin[]) =>
 *   skins.filter((s): s is MojangProfileSkin & { state: MojangAssetState } => s.state === "ACTIVE");
 * ```
 */
export type MojangAssetState = "ACTIVE" | "INACTIVE";

/**
 * Skin model variant Mojang serves for the player.
 *
 * @example
 * ```ts
 * import type { MojangSkinVariant } from "@loontail/minecraft-kit";
 *
 * const armOffset = (variant: MojangSkinVariant): number => (variant === "SLIM" ? 3 : 4);
 * ```
 */
export type MojangSkinVariant = "CLASSIC" | "SLIM";

/**
 * A single skin slot returned by `/minecraft/profile`.
 *
 * @example
 * ```ts
 * import type { MojangProfileSkin } from "@loontail/minecraft-kit";
 *
 * const active = (skins: readonly MojangProfileSkin[]) =>
 *   skins.find((s) => s.state === "ACTIVE");
 * console.log(active(session.minecraft.skins)?.url);
 * ```
 */
export type MojangProfileSkin = {
  readonly id: string;
  readonly state: MojangAssetState;
  readonly url: string;
  readonly variant: MojangSkinVariant;
};

/**
 * A cape slot returned by `/minecraft/profile`.
 *
 * @example
 * ```ts
 * import type { MojangProfileCape } from "@loontail/minecraft-kit";
 *
 * const equipped = (capes: readonly MojangProfileCape[]) =>
 *   capes.find((c) => c.state === "ACTIVE");
 * console.log(equipped(session.minecraft.capes)?.alias);
 * ```
 */
export type MojangProfileCape = {
  readonly id: string;
  readonly state: MojangAssetState;
  readonly url: string;
  readonly alias?: string;
};

/**
 * Combined Microsoft + Minecraft session returned by `kit.auth.login`,
 * `kit.auth.refresh`, and `kit.auth.authorizationCode.run`.
 *
 * The fields under {@link minecraft} are everything {@link OnlineAuth} needs plus the
 * raw `/minecraft/profile` payload so callers do not have to re-fetch it for skin/cape UI.
 * The fields under {@link microsoft} are needed only to refresh the session later —
 * persist them to durable storage (encrypted) alongside the user's profile.
 *
 * @example
 * ```ts
 * import { toOnlineAuth, type MojangSession } from "@loontail/minecraft-kit";
 *
 * const session: MojangSession = await kit.auth.authorizationCode.run({ onOpenBrowser });
 * await secrets.save(session.microsoft.refreshToken);
 * await kit.launch.compose(target, { auth: toOnlineAuth(session) });
 * ```
 */
export type MojangSession = {
  readonly minecraft: {
    /** Player display name. */
    readonly username: string;
    /** Player UUID, dashed (e.g. `f81d4fae-7dec-11d0-a765-00a0c91e6bf6`). */
    readonly uuid: string;
    /** Bearer token for `api.minecraftservices.com` and the game itself. */
    readonly accessToken: string;
    /** Wall-clock ms timestamp when {@link accessToken} expires. */
    readonly expiresAt: number;
    /** Xbox User ID (XUID) as a numeric string. */
    readonly xuid: string;
    /** Every skin slot Mojang has issued for the user (active + inactive). */
    readonly skins: ReadonlyArray<MojangProfileSkin>;
    /** Every cape slot Mojang has issued for the user. Empty when the user owns no capes. */
    readonly capes: ReadonlyArray<MojangProfileCape>;
  };
  readonly microsoft: {
    /** Microsoft refresh token; used to obtain a fresh session without re-prompting. */
    readonly refreshToken: string;
    /** Azure AD application id used to mint the session. */
    readonly clientId: AzureClientId;
  };
};
