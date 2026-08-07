import { withOptionalSignal } from "../core/optional";
import type {
  MicrosoftRefreshToken,
  MinecraftProfile,
  MojangSession,
  OnlineAuth,
} from "../types/auth";
import { AuthModes } from "../types/auth";
import type { HttpClient } from "../types/http";
import type { Logger } from "../types/logger";
import { resolveClientId } from "./client-id";
import { buildAuthLogger } from "./debug";
import { startLoopbackServer } from "./loopback";
import { exchangeAuthorizationCode, refreshMicrosoftToken } from "./microsoftToken";
import { buildAuthorizeUrl, generateOAuthState, generatePkcePair } from "./oauth";
import type { AuthorizationCodeRunOptions, RefreshOptions } from "./options";
import { exchangeMicrosoftToMojang } from "./pipeline";
import {
  type ResetSkinInput,
  resetSkin,
  type SetSkinFromUrlInput,
  setSkinFromUrl,
  type UploadSkinInput,
  uploadSkin,
} from "./profile-mutations";
import { type ReadProfileInput, readProfile } from "./profile-read";

export {
  asAzureClientId,
  asMicrosoftRefreshToken,
  CLIENT_ID_ENV_VAR,
} from "./client-id";
export type { AuthorizationCodeRunOptions, RefreshOptions } from "./options";

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
    const microsoftToken = await refreshMicrosoftToken({
      http: this.http,
      refreshToken,
      clientId,
      ...withOptionalSignal(options.signal),
    });
    return exchangeMicrosoftToMojang({
      http: this.http,
      microsoftToken,
      clientId,
      logger: this.logger,
      ...withOptionalSignal(options.signal),
    });
  }

  /**
   * Player profile against `api.minecraftservices.com/minecraft/profile`.
   * `read` GETs the current snapshot (cheap access-token validation); the
   * remaining methods mutate the active skin. Every method returns the
   * (post-mutation) {@link MinecraftProfile} snapshot so a launcher can
   * refresh its UI without an extra GET round-trip.
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
    read: (input: ReadProfileInput): Promise<MinecraftProfile> => readProfile(this.http, input),
    setSkinFromUrl: (input: SetSkinFromUrlInput): Promise<MinecraftProfile> =>
      setSkinFromUrl(this.http, input),
    uploadSkin: (input: UploadSkinInput): Promise<MinecraftProfile> => uploadSkin(this.http, input),
    resetSkin: (input: ResetSkinInput): Promise<MinecraftProfile> => resetSkin(this.http, input),
  };

  /**
   * OAuth 2.0 Authorization Code + PKCE with loopback redirect. The kit binds a temporary
   * HTTP server on `127.0.0.1:<random>`, hands the caller an
   * `https://login.microsoftonline.com/...` URL to open in the system browser, captures
   * the redirect, and finishes the full pipeline.
   *
   * `onOpenBrowser` is the only required callback — everything else is plumbing the caller
   * does not need to think about.
   */
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
        const microsoftToken = await exchangeAuthorizationCode({
          http: this.http,
          code,
          codeVerifier,
          redirectUri,
          clientId,
          ...withOptionalSignal(options.signal),
        });
        return await exchangeMicrosoftToMojang({
          http: this.http,
          microsoftToken,
          clientId,
          logger: this.logger,
          ...withOptionalSignal(options.signal),
        });
      } finally {
        await server.close();
      }
    },
  };
}

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
 */
const buildLoopbackRedirectUri = (port: number): string => `http://localhost:${port}`;
