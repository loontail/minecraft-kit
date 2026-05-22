import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { postFormUrlEncoded } from "../http/postForm";
import { isHttpOk } from "../http/status";
import type { AzureClientId, MicrosoftRefreshToken } from "../types/auth";
import type { HttpClient } from "../types/http";

const TENANT = "consumers";
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;

/**
 * Scope required for Minecraft. `XboxLive.signin` unlocks the Xbox Live token exchange and
 * `offline_access` is what causes Microsoft to return a refresh token.
 */
const SCOPE = "XboxLive.signin offline_access";

/**
 * Microsoft access + refresh tokens. Internal — callers receive the higher-level
 * `MojangSession` (from `../types/auth`) instead.
 *
 * @internal
 */
export type MicrosoftToken = {
  readonly accessToken: string;
  readonly refreshToken: MicrosoftRefreshToken;
  readonly expiresIn: number;
};

type TokenSuccess = {
  readonly token_type: "Bearer";
  readonly scope: string;
  readonly expires_in: number;
  readonly access_token: string;
  readonly refresh_token?: string;
};

type TokenError = {
  readonly error: string;
  readonly error_description?: string;
};

type TokenResponse =
  | { readonly ok: true; readonly status: number; readonly token: TokenSuccess }
  | { readonly ok: false; readonly status: number; readonly error: TokenError };

/**
 * Typed wrapper around {@link postFormUrlEncoded} for Microsoft's
 * `/consumers/oauth2/v2.0/token` endpoint. Splits the response into the `TokenSuccess` /
 * `TokenError` discriminated union; each grant caller decides how to react.
 */
const postTokenRequest = async (
  http: HttpClient,
  body: URLSearchParams,
  signal: AbortSignal | undefined,
): Promise<TokenResponse> => {
  const { status, json } = await postFormUrlEncoded(http, TOKEN_URL, body, signal);
  if (isHttpOk(status)) {
    return { ok: true, status, token: json as TokenSuccess };
  }
  return { ok: false, status, error: json as TokenError };
};

/**
 * Exchange a long-lived refresh token for a fresh Microsoft access token + (rotated)
 * refresh token. Mirrors the `refresh_token` grant from the OAuth 2.0 spec.
 *
 * @internal
 */
export const refreshMicrosoftToken = async (input: {
  readonly http: HttpClient;
  readonly refreshToken: MicrosoftRefreshToken;
  readonly clientId: AzureClientId;
  readonly signal?: AbortSignal;
}): Promise<MicrosoftToken> => {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    refresh_token: input.refreshToken,
    scope: SCOPE,
  });
  const result = await postTokenRequest(input.http, body, input.signal);
  if (!result.ok) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_REFRESH_FAILED,
      `Microsoft refused to refresh the token: ${result.error.error ?? "unknown_error"}${
        result.error.error_description ? ` — ${result.error.error_description}` : ""
      }`,
      { context: { httpStatus: result.status, microsoftError: result.error.error } },
    );
  }
  return {
    accessToken: result.token.access_token,
    refreshToken: brandRefreshToken(result.token.refresh_token, input.refreshToken),
    expiresIn: result.token.expires_in,
  };
};

const brandRefreshToken = (
  rotated: string | undefined,
  previous: MicrosoftRefreshToken,
): MicrosoftRefreshToken =>
  rotated !== undefined && rotated.length > 0 ? (rotated as MicrosoftRefreshToken) : previous;

/**
 * Exchange a one-time authorization `code` (returned by Microsoft on the loopback
 * redirect) for a Microsoft access + refresh token. PKCE-protected: the caller must
 * pass the same `codeVerifier` whose hash they sent as `code_challenge` in the
 * authorize URL.
 *
 * @internal
 */
export const exchangeAuthorizationCode = async (input: {
  readonly http: HttpClient;
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly clientId: AzureClientId;
  readonly signal?: AbortSignal;
}): Promise<MicrosoftToken> => {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    scope: SCOPE,
  });
  const result = await postTokenRequest(input.http, body, input.signal);
  if (!result.ok) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_AUTHORIZATION_CODE_FAILED,
      `Microsoft refused to exchange the authorization code: ${result.error.error ?? "unknown_error"}${
        result.error.error_description ? ` — ${result.error.error_description}` : ""
      }`,
      { context: { httpStatus: result.status, microsoftError: result.error.error } },
    );
  }
  if (!result.token.refresh_token) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_AUTHORIZATION_CODE_FAILED,
      "Microsoft did not return a refresh token. Make sure `offline_access` is in the requested scopes.",
    );
  }
  return {
    accessToken: result.token.access_token,
    refreshToken: result.token.refresh_token as MicrosoftRefreshToken,
    expiresIn: result.token.expires_in,
  };
};
