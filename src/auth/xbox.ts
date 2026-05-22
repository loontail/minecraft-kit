import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { withOptionalSignal } from "../core/optional";
import type { HttpClient } from "../types/http";
import type { Logger } from "../types/logger";

const XBL_URL = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";

/**
 * Result of either XBL or XSTS authentication: the JWT plus the user hash that prefixes the
 * Minecraft `identityToken`.
 *
 * @internal
 */
export type XboxToken = {
  readonly token: string;
  readonly userHash: string;
};

type XboxResponse = {
  readonly Token: string;
  readonly DisplayClaims?: { readonly xui?: ReadonlyArray<{ readonly uhs?: string }> };
};

type XstsErrorResponse = {
  readonly Identity?: string;
  readonly XErr?: number;
  readonly Message?: string;
  readonly Redirect?: string;
};

/**
 * Step 2 — exchange the Microsoft access token for an Xbox Live user token.
 *
 * @internal
 */
export const authenticateXbl = async (input: {
  readonly http: HttpClient;
  readonly accessToken: string;
  readonly signal?: AbortSignal;
  readonly logger?: Logger;
}): Promise<XboxToken> => {
  const body = JSON.stringify({
    Properties: {
      AuthMethod: "RPS",
      SiteName: "user.auth.xboxlive.com",
      RpsTicket: `d=${input.accessToken}`,
    },
    RelyingParty: "http://auth.xboxlive.com",
    TokenType: "JWT",
  });
  let response: Awaited<ReturnType<HttpClient["request"]>>;
  try {
    response = await input.http.request(XBL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
      ...withOptionalSignal(input.signal),
    });
  } catch (cause) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_XBOX_FAILED,
      "Xbox Live authentication failed.",
      {
        cause,
      },
    );
  }
  const parsed = (await response.json()) as XboxResponse;
  const userHash = parsed.DisplayClaims?.xui?.[0]?.uhs;
  if (!parsed.Token || !userHash) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_XBOX_FAILED,
      "Xbox Live authentication returned an incomplete response.",
    );
  }
  input.logger?.log("debug", `XBL ok — tokenLen=${parsed.Token.length}, userHash=${userHash}`);
  return { token: parsed.Token, userHash };
};

/**
 * Step 3 — exchange the XBL token for an XSTS token bound to `api.minecraftservices.com`.
 *
 * XSTS uses HTTP 401 + a `XErr` numeric code in the body to surface account-level problems
 * (no Xbox profile, country restriction, child account…). Those codes are mapped to a single
 * `AUTH_XSTS_FAILED` error with a human-friendly message — callers can branch on `xerr` in
 * the context if they need finer-grained handling.
 *
 * @internal
 */
export const authenticateXsts = async (input: {
  readonly http: HttpClient;
  readonly xblToken: string;
  readonly signal?: AbortSignal;
  readonly logger?: Logger;
}): Promise<XboxToken> => {
  const body = JSON.stringify({
    Properties: { SandboxId: "RETAIL", UserTokens: [input.xblToken] },
    RelyingParty: "rp://api.minecraftservices.com/",
    TokenType: "JWT",
  });
  const response = await input.http.request(XSTS_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body,
    acceptNonOk: true,
    ...withOptionalSignal(input.signal),
  });
  if (response.status === 401) {
    const err = (await response.json().catch(() => ({}))) as XstsErrorResponse;
    throw new MinecraftKitError(MinecraftKitErrorCodes.AUTH_XSTS_FAILED, explainXErr(err.XErr), {
      context: { xerr: err.XErr ?? null, message: err.Message ?? null },
    });
  }
  if (response.status < 200 || response.status >= 300) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_XSTS_FAILED,
      `XSTS authorization failed with HTTP ${response.status}.`,
      { context: { httpStatus: response.status } },
    );
  }
  const parsed = (await response.json()) as XboxResponse;
  const userHash = parsed.DisplayClaims?.xui?.[0]?.uhs;
  if (!parsed.Token || !userHash) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_XSTS_FAILED,
      "XSTS authorization returned an incomplete response.",
    );
  }
  input.logger?.log("debug", `XSTS ok — tokenLen=${parsed.Token.length}, userHash=${userHash}`);
  return { token: parsed.Token, userHash };
};

/**
 * Named constants for the XSTS `XErr` values we explicitly explain to users.
 * Microsoft documents the codes in the "Authenticate XBL with XSTS" guide.
 *
 * @internal
 */
const XBOX_ERROR_CODES = {
  Banned: 2_148_916_227,
  NoProfile: 2_148_916_233,
  RegionBlocked: 2_148_916_235,
  AdultVerificationRequired: 2_148_916_236,
  AdultVerificationRequiredAlt: 2_148_916_237,
  ChildAccount: 2_148_916_238,
} as const;

const ADULT_VERIFICATION_MESSAGE =
  "This account needs an adult to verify it. Sign in on Xbox to complete the prompt.";

const XBOX_ERROR_MESSAGES: Record<
  (typeof XBOX_ERROR_CODES)[keyof typeof XBOX_ERROR_CODES],
  string
> = {
  [XBOX_ERROR_CODES.Banned]: "This account has been banned from Xbox.",
  [XBOX_ERROR_CODES.NoProfile]:
    "This Microsoft account has no Xbox profile yet — sign in once at https://minecraft.net to create one.",
  [XBOX_ERROR_CODES.RegionBlocked]: "Xbox Live is not available in this account's country/region.",
  [XBOX_ERROR_CODES.AdultVerificationRequired]: ADULT_VERIFICATION_MESSAGE,
  [XBOX_ERROR_CODES.AdultVerificationRequiredAlt]: ADULT_VERIFICATION_MESSAGE,
  [XBOX_ERROR_CODES.ChildAccount]:
    "This is a child account. Add it to a Microsoft family group with an adult to continue.",
};

const explainXErr = (xerr: number | undefined): string => {
  if (xerr !== undefined && xerr in XBOX_ERROR_MESSAGES) {
    return XBOX_ERROR_MESSAGES[xerr as keyof typeof XBOX_ERROR_MESSAGES];
  }
  return xerr ? `XSTS authorization failed (XErr ${xerr}).` : "XSTS authorization failed.";
};
