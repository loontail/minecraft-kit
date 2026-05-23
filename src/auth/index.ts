import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { withOptionalSignal } from "../core/optional";
import { AuthModes } from "../types/auth";
import type {
  AzureClientId,
  MicrosoftRefreshToken,
  MinecraftProfile,
  MojangSession,
  OnlineAuth,
} from "../types/auth";
import type { HttpClient } from "../types/http";
import type { Logger } from "../types/logger";
import { buildAuthLogger } from "./debug";
import { startLoopbackServer } from "./loopback";
import {
  type MicrosoftToken,
  exchangeAuthorizationCode,
  refreshMicrosoftToken,
} from "./microsoftToken";
import { extractXuid, fetchMinecraftProfile, loginWithXbox } from "./minecraft";
import { buildAuthorizeUrl, generateOAuthState, generatePkcePair } from "./oauth";
import {
  type ResetSkinInput,
  type SetSkinFromUrlInput,
  type UploadSkinInput,
  resetSkin,
  setSkinFromUrl,
  uploadSkin,
} from "./profile-mutations";
import { authenticateXbl, authenticateXsts } from "./xbox";

/**
 * Env var consulted when no explicit `clientId` is supplied.
 *
 * @example
 * ```ts
 * import { CLIENT_ID_ENV_VAR } from "@loontail/minecraft-kit";
 *
 * if (!process.env[CLIENT_ID_ENV_VAR]) {
 *   throw new Error(`${CLIENT_ID_ENV_VAR} is not set — sign in is unavailable`);
 * }
 * ```
 */
export const CLIENT_ID_ENV_VAR = "MINECRAFT_KIT_MSA_CLIENT_ID";

const AZURE_CLIENT_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Validate `raw` as an Azure AD application id and brand it as {@link AzureClientId}.
 * Throws `MinecraftKitError(INVALID_INPUT)` if the input is empty or does not match the
 * GUID-ish shape Azure uses (hex characters and dashes, at least 8 characters).
 *
 * @example
 * ```ts
 * import { asAzureClientId } from "@loontail/minecraft-kit";
 *
 * const clientId = asAzureClientId(process.env.MSA_CLIENT_ID ?? "");
 * await kit.auth.authorizationCode.run({ clientId, onOpenBrowser });
 * ```
 */
export const asAzureClientId = (raw: string): AzureClientId => {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || !AZURE_CLIENT_ID_PATTERN.test(trimmed)) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `"${raw}" does not look like an Azure AD client id. Expected the canonical 8-4-4-4-12 GUID format.`,
    );
  }
  return trimmed as AzureClientId;
};

/**
 * Brand `raw` as a {@link MicrosoftRefreshToken}. Validates only that the value is
 * non-empty after trimming — Microsoft refresh tokens are opaque, so the
 * constructor's job is to put a brand on the value, not to second-guess
 * Microsoft's format.
 *
 * @example
 * ```ts
 * import { asMicrosoftRefreshToken } from "@loontail/minecraft-kit";
 *
 * const token = asMicrosoftRefreshToken(await storage.load("ms-refresh"));
 * await kit.auth.refresh(token, { clientId });
 * ```
 */
export const asMicrosoftRefreshToken = (raw: string): MicrosoftRefreshToken => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      "Microsoft refresh token cannot be empty.",
    );
  }
  return trimmed as MicrosoftRefreshToken;
};

/**
 * Options accepted by {@link MojangAuthApi.refresh}.
 *
 * @example
 * ```ts
 * import type { RefreshOptions } from "@loontail/minecraft-kit";
 *
 * const options: RefreshOptions = { clientId: "00000000-0000-0000-0000-000000000000" };
 * const session = await kit.auth.refresh(savedRefreshToken, options);
 * ```
 */
export type RefreshOptions = {
  /** Azure AD application id; defaults to `process.env.MINECRAFT_KIT_MSA_CLIENT_ID`. */
  readonly clientId?: AzureClientId;
  readonly signal?: AbortSignal;
};

/**
 * Options accepted by `kit.auth.authorizationCode.run`.
 *
 * @example
 * ```ts
 * import type { AuthorizationCodeRunOptions } from "@loontail/minecraft-kit";
 *
 * const options: AuthorizationCodeRunOptions = {
 *   onOpenBrowser: (url) => open(url),
 *   successHtml: "<h1>Signed in — return to the launcher.</h1>",
 * };
 * const session = await kit.auth.authorizationCode.run(options);
 * ```
 */
export type AuthorizationCodeRunOptions = {
  /**
   * Azure AD application id. When omitted, the value of
   * `process.env.MINECRAFT_KIT_MSA_CLIENT_ID` is used. Throws `AUTH_MISSING_CLIENT_ID` if
   * neither is set — the library cannot ship a default client id.
   */
  readonly clientId?: AzureClientId;
  /**
   * Called exactly once with the authorize URL. The caller is expected to open this URL
   * in the user's system browser (e.g. `shell.openExternal` in Electron, `xdg-open`
   * / `open` / `start` in a CLI). The kit does not assume how to open browsers — that
   * decision belongs to the host environment.
   */
  readonly onOpenBrowser: (url: string) => void | Promise<void>;
  /** Loopback port to bind. Defaults to `0` (OS picks). */
  readonly port?: number;
  /** Optional HTML returned to the browser after a successful capture. */
  readonly successHtml?: string;
  /** Aborting cancels both the loopback server and the post-MS-token pipeline. */
  readonly signal?: AbortSignal;
};

/**
 * High-level Microsoft / Mojang auth surface attached to `MinecraftKit`
 * as `kit.auth`. Sign-in uses the OAuth 2.0 Authorization Code + PKCE flow with a
 * loopback redirect (`kit.auth.authorizationCode`): the kit opens a
 * localhost server, the caller opens the system browser, the user signs in, and the
 * browser redirects back. The flow continues through the Xbox → XSTS → Minecraft
 * pipeline and returns a {@link MojangSession} carrying everything launch composition
 * needs plus the Microsoft refresh token. The library does NOT persist tokens —
 * that's the caller's job.
 *
 * @example
 * ```ts
 * import { MinecraftKit, toOnlineAuth } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const session = await kit.auth.authorizationCode.run({
 *   onOpenBrowser: (url) => open(url),
 * });
 * await saveRefreshToken(session.microsoft.refreshToken);
 * const launch = await kit.launch.compose(target, { auth: toOnlineAuth(session) });
 * ```
 */
export class MojangAuthApi {
  private readonly logger: Logger;

  constructor(
    private readonly http: HttpClient,
    logger?: Logger,
  ) {
    this.logger = buildAuthLogger(logger);
  }

  /** Refresh a previously obtained session. The Microsoft refresh token may be rotated. */
  async refresh(
    refreshToken: MicrosoftRefreshToken,
    options: RefreshOptions = {},
  ): Promise<MojangSession> {
    const clientId = resolveClientId(options.clientId);
    const msToken = await refreshMicrosoftToken({
      http: this.http,
      refreshToken,
      clientId,
      ...withOptionalSignal(options.signal),
    });
    return runPostMsTokenPipeline(this.http, msToken, clientId, options.signal, this.logger);
  }

  /**
   * OAuth 2.0 Authorization Code + PKCE with loopback redirect. The kit binds a temporary
   * HTTP server on `127.0.0.1:<random>`, hands the caller an `https://login.microsoftonline.com/...`
   * URL to open in the system browser, captures the redirect, and finishes the full pipeline.
   *
   * `onOpenBrowser` is the only required callback — everything else is plumbing the caller
   * does not need to think about.
   */
  /**
   * Skin mutations against `api.minecraftservices.com/minecraft/profile`.
   * Every method returns the updated {@link MinecraftProfile} snapshot so a
   * launcher can refresh its UI without an extra GET round-trip.
   *
   * @example
   * ```ts
   * import { MinecraftKit } from "@loontail/minecraft-kit";
   *
   * const kit = new MinecraftKit();
   * const session = await kit.auth.authorizationCode.run({ onOpenBrowser });
   * await kit.auth.profile.setSkinFromUrl({
   *   accessToken: session.minecraft.accessToken,
   *   url: "https://textures.minecraft.net/texture/abc...",
   *   variant: "CLASSIC",
   * });
   * ```
   */
  readonly profile = {
    setSkinFromUrl: (input: SetSkinFromUrlInput): Promise<MinecraftProfile> =>
      setSkinFromUrl(this.http, input),
    uploadSkin: (input: UploadSkinInput): Promise<MinecraftProfile> => uploadSkin(this.http, input),
    resetSkin: (input: ResetSkinInput): Promise<MinecraftProfile> => resetSkin(this.http, input),
  };

  readonly authorizationCode = {
    run: async (options: AuthorizationCodeRunOptions): Promise<MojangSession> => {
      const clientId = resolveClientId(options.clientId);
      const state = generateOAuthState();
      const { codeVerifier, codeChallenge } = generatePkcePair();

      const server = await startLoopbackServer({
        expectedState: state,
        logger: this.logger,
        ...(options.port !== undefined ? { port: options.port } : {}),
        ...(options.successHtml !== undefined ? { successHtml: options.successHtml } : {}),
        ...withOptionalSignal(options.signal),
      });

      try {
        const redirectUri = buildLoopbackRedirectUri(server.port);
        const url = buildAuthorizeUrl({ clientId, redirectUri, state, codeChallenge });
        await options.onOpenBrowser(url);
        const { code } = await server.captured;
        const msToken = await exchangeAuthorizationCode({
          http: this.http,
          code,
          codeVerifier,
          redirectUri,
          clientId,
          ...withOptionalSignal(options.signal),
        });
        return await runPostMsTokenPipeline(
          this.http,
          msToken,
          clientId,
          options.signal,
          this.logger,
        );
      } finally {
        await server.close();
      }
    },
  };
}

/** Steps 2 → 5 of the auth pipeline: turn a Microsoft access token into a Mojang session. */
const runPostMsTokenPipeline = async (
  http: HttpClient,
  msToken: MicrosoftToken,
  clientId: AzureClientId,
  signal: AbortSignal | undefined,
  logger: Logger,
): Promise<MojangSession> => {
  const xbl = await authenticateXbl({
    http,
    accessToken: msToken.accessToken,
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
      refreshToken: msToken.refreshToken,
      clientId,
    },
  };
};

/**
 * Project a {@link MojangSession} into the {@link OnlineAuth} shape that `kit.launch.compose`
 * accepts.
 *
 * @example
 * ```ts
 * import { toOnlineAuth } from "@loontail/minecraft-kit";
 *
 * const session = await kit.auth.refresh(savedRefreshToken);
 * const composition = await kit.launch.compose(target, { auth: toOnlineAuth(session) });
 * const proc = kit.launch.run(composition);
 * ```
 */
export const toOnlineAuth = (session: MojangSession): OnlineAuth => {
  return {
    mode: AuthModes.ONLINE,
    username: session.minecraft.username,
    uuid: session.minecraft.uuid,
    accessToken: session.minecraft.accessToken,
    userType: "msa",
    clientId: session.microsoft.clientId,
    xuid: session.minecraft.xuid,
  };
};

/**
 * Build the OAuth redirect URI Microsoft will redirect the browser to.
 *
 * Microsoft's loopback rule: register `http://localhost` (no port, no path) in the
 * Azure AD application; at runtime use `http://localhost:<any-port>` with the SAME
 * path. Anything beyond the registered URI (a `/oauth/callback` suffix, for example)
 * makes Microsoft reject the request with `invalid_request`. We use `localhost`
 * rather than `127.0.0.1` because Microsoft treats those two as distinct redirect
 * strings; the loopback server itself still binds on the IPv4 loopback only.
 *
 * @internal
 */
const buildLoopbackRedirectUri = (port: number): string => `http://localhost:${port}`;

const resolveClientId = (explicit: AzureClientId | undefined): AzureClientId => {
  if (explicit !== undefined) return explicit;
  const fromEnv = process.env[CLIENT_ID_ENV_VAR];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return asAzureClientId(fromEnv);
  throw new MinecraftKitError(
    MinecraftKitErrorCodes.AUTH_MISSING_CLIENT_ID,
    `No Azure AD client id supplied. Pass \`clientId\` explicitly or set ${CLIENT_ID_ENV_VAR}. Register an Azure AD application in the 'Personal Microsoft accounts' audience with XboxLive.signin + offline_access scopes to obtain one.`,
  );
};
