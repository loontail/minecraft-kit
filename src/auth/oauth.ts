import { createHash, randomBytes } from "node:crypto";
import type { AzureClientId } from "../types/auth";

/**
 * Authorization Code + PKCE helpers (RFC 7636) for the Microsoft Identity Platform.
 *
 * Pure utilities — no I/O. Used by the high-level `MojangAuthApi.authorizationCode`
 * surface, but exported separately so callers building their own browser flow can
 * compose them with their own loopback handling.
 */

/** Microsoft tenant used for personal (consumer) Microsoft accounts. */
const TENANT = "consumers";

/** Authorize endpoint we redirect the user's browser to. */
const AUTHORIZE_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;

/** Authorize prompt that forces Microsoft to show the account picker even on a signed-in browser. */
const MICROSOFT_PROMPT_SELECT_ACCOUNT = "select_account";

/**
 * Scopes consumed by the Minecraft pipeline. Must match the device-code flow's scope
 * (see `auth/microsoft.ts`) so the refresh token Microsoft hands back works against
 * both flows interchangeably.
 */
const SCOPE = "XboxLive.signin offline_access";

/**
 * PKCE verifier + S256 challenge. Length matches the RFC 7636 maximum (128 chars).
 *
 * @internal
 */
export type PkcePair = {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
};

/** RFC 4648 §5 base64url, no padding. Buffer.toString("base64url") matches the spec. */
const toBase64Url = (bytes: Buffer): string => bytes.toString("base64url");

/**
 * Generate a fresh PKCE pair. The verifier is 64 random bytes (well above the 43-byte
 * minimum) and the challenge is the S256 hash of the verifier — that's what we hand
 * Microsoft in the authorize URL.
 *
 * @internal
 */
export const generatePkcePair = (): PkcePair => {
  const codeVerifier = toBase64Url(randomBytes(64));
  const codeChallenge = toBase64Url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
};

/**
 * Opaque per-request state nonce. The kit threads this through the authorize URL and
 * re-checks it on the redirect to defend against cross-origin CSRF.
 *
 * @internal
 */
export const generateOAuthState = (): string => toBase64Url(randomBytes(32));

/**
 * Options for {@link buildAuthorizeUrl}.
 *
 * @internal
 */
export type BuildAuthorizeUrlOptions = {
  /** Azure AD application id. */
  readonly clientId: AzureClientId;
  /** Loopback redirect URI registered with the app (e.g. `http://127.0.0.1:54321/oauth/callback`). */
  readonly redirectUri: string;
  /** Opaque state from {@link generateOAuthState}. */
  readonly state: string;
  /** PKCE S256 challenge from {@link generatePkcePair}. */
  readonly codeChallenge: string;
  /**
   * When `true` (default) appends `prompt=select_account`, forcing Microsoft to show the
   * account picker even if the browser is already signed in. Matches the Google sign-in
   * UX where users always confirm which account they're using.
   */
  readonly promptSelectAccount?: boolean;
};

/**
 * Build the authorize URL the user's browser should be sent to. Pure — does no I/O,
 * just composes a querystring. Callers feed the returned string to their browser-opening
 * mechanism (e.g. `shell.openExternal`).
 *
 * @internal
 */
export const buildAuthorizeUrl = (options: BuildAuthorizeUrlOptions): string => {
  const params = new URLSearchParams({
    client_id: options.clientId,
    response_type: "code",
    redirect_uri: options.redirectUri,
    response_mode: "query",
    scope: SCOPE,
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
  });
  if (options.promptSelectAccount ?? true) {
    params.set("prompt", MICROSOFT_PROMPT_SELECT_ACCOUNT);
  }
  return `${AUTHORIZE_URL}?${params.toString()}`;
};
