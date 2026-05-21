import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import type { DeviceCodePrompt, DeviceCodeState } from "../types/auth";
import type { HttpClient } from "../types/http";

const TENANT = "consumers";
const DEVICE_CODE_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/devicecode`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;

/**
 * Scope required for Minecraft. `XboxLive.signin` unlocks the Xbox Live token exchange and
 * `offline_access` is what causes Microsoft to return a refresh token.
 */
const SCOPE = "XboxLive.signin offline_access";

/**
 * Microsoft access + refresh tokens. Internal — callers receive the higher-level
 * {@link import("../types/auth").MojangSession} instead.
 */
export type MicrosoftToken = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
};

type DeviceCodeResponse = {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri: string;
  readonly message: string;
  readonly expires_in: number;
  readonly interval: number;
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
 * Shared POST to `/consumers/oauth2/v2.0/token` used by every grant — device_code,
 * refresh_token, and authorization_code. Each caller decides how to interpret the
 * Microsoft `error` field, so this helper just returns the parsed body either way.
 */
const postTokenRequest = async (
  http: HttpClient,
  body: URLSearchParams,
  signal: AbortSignal | undefined,
): Promise<TokenResponse> => {
  const response = await http.request(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString(),
    acceptNonOk: true,
    ...(signal !== undefined ? { signal } : {}),
  });
  if (response.status >= 200 && response.status < 300) {
    const token = (await response.json()) as TokenSuccess;
    return { ok: true, status: response.status, token };
  }
  const error = (await response.json().catch(() => ({}))) as TokenError;
  return { ok: false, status: response.status, error };
};

/** Start a device-code session against Microsoft's `/devicecode` endpoint. */
export const startDeviceCode = async (input: {
  readonly http: HttpClient;
  readonly clientId: string;
  readonly signal?: AbortSignal;
}): Promise<{ readonly prompt: DeviceCodePrompt; readonly state: DeviceCodeState }> => {
  const body = new URLSearchParams({ client_id: input.clientId, scope: SCOPE });
  const response = await input.http.request(DEVICE_CODE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString(),
    // We need to read the body of 400/401 responses to surface Microsoft's actual
    // `error_description` rather than reporting "HTTP 400" — the most common cause is
    // an app registration that doesn't allow personal MSA accounts or hasn't enabled
    // public client flows.
    acceptNonOk: true,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  });
  if (response.status < 200 || response.status >= 300) {
    const err = (await response.json().catch(() => ({}))) as TokenError;
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_DEVICE_CODE_FAILED,
      explainDeviceCodeError(err, input.clientId),
      {
        context: {
          httpStatus: response.status,
          microsoftError: err.error,
          clientId: input.clientId,
        },
      },
    );
  }
  const data = (await response.json()) as DeviceCodeResponse;
  const now = Date.now();
  const state: DeviceCodeState = {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    message: data.message,
    expiresIn: data.expires_in,
    interval: data.interval,
    clientId: input.clientId,
    expiresAt: now + data.expires_in * 1000,
  };
  const prompt: DeviceCodePrompt = {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    message: data.message,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
  return { prompt, state };
};

/**
 * Exchange a long-lived refresh token for a fresh Microsoft access token + (rotated)
 * refresh token. Mirrors the `refresh_token` grant from the OAuth 2.0 spec.
 */
export const refreshMicrosoftToken = async (input: {
  readonly http: HttpClient;
  readonly refreshToken: string;
  readonly clientId: string;
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
    refreshToken: result.token.refresh_token ?? input.refreshToken,
    expiresIn: result.token.expires_in,
  };
};

/**
 * Exchange a one-time authorization `code` (returned by Microsoft on the loopback
 * redirect) for a Microsoft access + refresh token. PKCE-protected: the caller must
 * pass the same `codeVerifier` whose hash they sent as `code_challenge` in the
 * authorize URL.
 */
export const exchangeAuthorizationCode = async (input: {
  readonly http: HttpClient;
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly clientId: string;
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
    refreshToken: result.token.refresh_token,
    expiresIn: result.token.expires_in,
  };
};

/**
 * Translate Microsoft's `/devicecode` error into a sentence that points the operator at the
 * Azure setting they likely got wrong. The vanilla `error_description` from MS is often a
 * 200-character wall of text — readable, but not actionable.
 */
const explainDeviceCodeError = (err: TokenError, clientId: string): string => {
  const desc = err.error_description ?? "";
  const ms = desc ? ` — ${desc}` : "";
  // AADSTS sub-codes carry the actual root cause. Microsoft maps several distinct app-side
  // misconfigurations onto the same OAuth top-level `error` value (e.g. `unauthorized_client`
  // covers both "public flows disabled" and "wrong supported account types"). Detect the
  // sub-code first so we can give a precise hint.
  if (/AADSTS700016/i.test(desc) || /not found in the directory/i.test(desc)) {
    return `Microsoft cannot see app ${clientId} from the consumers tenant. Fix: Azure portal → your app → Authentication → "Supported account types" → choose "Personal Microsoft accounts only" or "Multitenant + personal accounts" → Save. Wait ~30s for propagation.${ms}`;
  }
  if (/AADSTS7000218/i.test(desc) || /must either be a confidential client/i.test(desc)) {
    return `Microsoft rejected the client_id (${clientId}): "Allow public client flows" is OFF. Fix: Azure portal → your app → Authentication → bottom of the page → toggle "Allow public client flows" to Yes → Save.${ms}`;
  }
  if (/AADSTS50059/i.test(desc) || /tenant identifier/i.test(desc)) {
    return `Microsoft Entra cannot route the request — the app's "Supported account types" excludes consumers. Fix: Azure portal → Authentication → set Supported account types to include personal MSA → Save.${ms}`;
  }
  switch (err.error) {
    case "unauthorized_client":
      return `Microsoft rejected the client_id (${clientId}). Likely cause: "Supported account types" excludes personal Microsoft accounts, OR "Allow public client flows" is disabled. Fix both in Azure portal → your app → Authentication.${ms}`;
    case "invalid_client":
      return `Microsoft does not recognise client_id ${clientId}. Make sure you pasted the Application (client) ID — not the Object ID or Tenant ID — and that the app exists.${ms}`;
    case "invalid_request":
      return `Microsoft rejected the device-code request as malformed.${ms}`;
    case "invalid_scope":
      return `Microsoft refused the requested scope (XboxLive.signin offline_access). Make sure the app is configured for Microsoft account sign-in.${ms}`;
    default:
      return `Microsoft device-code request failed: ${err.error ?? "unknown_error"}${ms}`;
  }
};
