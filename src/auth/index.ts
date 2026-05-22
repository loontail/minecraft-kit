import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { AuthModes } from "../types/auth";
import type { MojangSession, OnlineAuth } from "../types/auth";
import type { HttpClient } from "../types/http";
import { authDebug } from "./debug";
import { startLoopbackServer } from "./loopback";
import {
  type MicrosoftToken,
  exchangeAuthorizationCode,
  refreshMicrosoftToken,
} from "./microsoftToken";
import { extractXuid, fetchMinecraftProfile, loginWithXbox } from "./minecraft";
import { buildAuthorizeUrl, generateOAuthState, generatePkcePair } from "./oauth";
import { authenticateXbl, authenticateXsts } from "./xbox";

/** Env var consulted when no explicit `clientId` is supplied. */
export const CLIENT_ID_ENV_VAR = "MINECRAFT_KIT_MSA_CLIENT_ID";

export { authDebug, buildAuthLogger, DEBUG_ENV_VAR } from "./debug";

/** Options accepted by {@link MojangAuthApi.refresh}. */
export type RefreshOptions = {
  /** Azure AD application id; defaults to `process.env.MINECRAFT_KIT_MSA_CLIENT_ID`. */
  readonly clientId?: string;
  readonly signal?: AbortSignal;
};

/** Options accepted by {@link MojangAuthApi.authorizationCode.run}. */
export type AuthorizationCodeRunOptions = {
  /**
   * Azure AD application id. When omitted, the value of
   * `process.env.MINECRAFT_KIT_MSA_CLIENT_ID` is used. Throws `AUTH_MISSING_CLIENT_ID` if
   * neither is set — the library cannot ship a default client id.
   */
  readonly clientId?: string;
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
 * High-level Microsoft / Mojang auth surface attached to {@link import("../kit").MinecraftKit}
 * as `kit.auth`. Sign-in uses the OAuth 2.0 Authorization Code + PKCE flow with a
 * loopback redirect ({@link MojangAuthApi.authorizationCode}): the kit opens a
 * localhost server, the caller opens the system browser, the user signs in, and the
 * browser redirects back. The flow continues through the Xbox → XSTS → Minecraft
 * pipeline and returns a {@link MojangSession} carrying everything launch composition
 * needs plus the Microsoft refresh token. The library does NOT persist tokens —
 * that's the caller's job.
 */
export class MojangAuthApi {
  constructor(private readonly http: HttpClient) {}

  /** Refresh a previously obtained session. The Microsoft refresh token may be rotated. */
  async refresh(refreshToken: string, options: RefreshOptions = {}): Promise<MojangSession> {
    const clientId = resolveClientId(options.clientId);
    const msToken = await refreshMicrosoftToken({
      http: this.http,
      refreshToken,
      clientId,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    return runPostMsTokenPipeline(this.http, msToken, clientId, options.signal);
  }

  /**
   * OAuth 2.0 Authorization Code + PKCE with loopback redirect. The kit binds a temporary
   * HTTP server on `127.0.0.1:<random>`, hands the caller an `https://login.microsoftonline.com/...`
   * URL to open in the system browser, captures the redirect, and finishes the full pipeline.
   *
   * `onOpenBrowser` is the only required callback — everything else is plumbing the caller
   * does not need to think about.
   */
  readonly authorizationCode = {
    run: async (options: AuthorizationCodeRunOptions): Promise<MojangSession> => {
      const t0 = Date.now();
      const lap = (label: string): void =>
        authDebug(`authorizationCode.run: ${label} (+${Date.now() - t0}ms)`);
      const clientId = resolveClientId(options.clientId);
      const state = generateOAuthState();
      const { codeVerifier, codeChallenge } = generatePkcePair();

      const server = await startLoopbackServer({
        expectedState: state,
        ...(options.port !== undefined ? { port: options.port } : {}),
        ...(options.successHtml !== undefined ? { successHtml: options.successHtml } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
      lap(`loopback bound on port ${server.port}`);

      try {
        // Microsoft's loopback rule: register `http://localhost` (no port, no path),
        // at runtime use `http://localhost:<any-port>` with the SAME path. Anything
        // beyond the registered URI (a `/oauth/callback` suffix, for example) makes
        // Microsoft reject the request with `invalid_request`. Stay on the root path.
        // The launcher uses `localhost` (not `127.0.0.1`) because Microsoft treats
        // those two as distinct strings; the loopback server still binds on the IPv4
        // loopback only.
        const redirectUri = `http://localhost:${server.port}`;
        const url = buildAuthorizeUrl({ clientId, redirectUri, state, codeChallenge });
        lap("authorize URL built — invoking onOpenBrowser");
        await options.onOpenBrowser(url);
        lap("onOpenBrowser returned — awaiting browser callback");
        const { code } = await server.captured;
        lap("callback captured — exchanging code for MS token");
        const msToken = await exchangeAuthorizationCode({
          http: this.http,
          code,
          codeVerifier,
          redirectUri,
          clientId,
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        });
        lap("MS token obtained — running Xbox/XSTS/Minecraft pipeline");
        const session = await runPostMsTokenPipeline(this.http, msToken, clientId, options.signal);
        lap("Mojang session built");
        return session;
      } finally {
        await server.close();
        lap("loopback closed");
      }
    },
  };
}

/** Steps 2 → 5 of the auth pipeline: turn a Microsoft access token into a Mojang session. */
const runPostMsTokenPipeline = async (
  http: HttpClient,
  msToken: MicrosoftToken,
  clientId: string,
  signal: AbortSignal | undefined,
): Promise<MojangSession> => {
  const signalOpt = signal !== undefined ? { signal } : {};
  const xbl = await authenticateXbl({ http, accessToken: msToken.accessToken, ...signalOpt });
  const xsts = await authenticateXsts({ http, xblToken: xbl.token, ...signalOpt });
  const mc = await loginWithXbox({
    http,
    xstsToken: xsts.token,
    userHash: xsts.userHash,
    ...signalOpt,
  });
  const profile = await fetchMinecraftProfile({ http, accessToken: mc.accessToken, ...signalOpt });

  return {
    minecraft: {
      username: profile.username,
      uuid: profile.uuid,
      accessToken: mc.accessToken,
      expiresAt: Date.now() + mc.expiresIn * 1000,
      xuid: extractXuid(mc.accessToken),
      skins: profile.skins,
      capes: profile.capes,
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

const resolveClientId = (explicit: string | undefined): string => {
  if (typeof explicit === "string" && explicit.trim().length > 0) return explicit.trim();
  const fromEnv = process.env[CLIENT_ID_ENV_VAR];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  throw new MinecraftKitError(
    MinecraftKitErrorCodes.AUTH_MISSING_CLIENT_ID,
    `No Azure AD client id supplied. Pass \`clientId\` explicitly or set ${CLIENT_ID_ENV_VAR}. Register an Azure AD application in the 'Personal Microsoft accounts' audience with XboxLive.signin + offline_access scopes to obtain one.`,
  );
};
