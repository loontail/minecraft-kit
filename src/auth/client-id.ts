/**
 * Azure AD application id + Microsoft refresh-token branding helpers. The library cannot
 * ship a default client id (Microsoft requires the calling application to register its
 * own); the consumer either passes one explicitly or sets `MINECRAFT_KIT_MSA_CLIENT_ID`,
 * and {@link resolveClientId} reconciles those two sources.
 *
 * @internal
 * @packageDocumentation
 */

import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import type { AzureClientId, MicrosoftRefreshToken } from "../types/auth";

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
 * Reconcile the caller-supplied `clientId` with `process.env[CLIENT_ID_ENV_VAR]`. Throws
 * `AUTH_MISSING_CLIENT_ID` when neither is available — the library cannot ship a default
 * because every consumer must register its own Azure AD application.
 *
 * @internal
 */
export const resolveClientId = (explicit: AzureClientId | undefined): AzureClientId => {
  if (explicit !== undefined) return explicit;
  const fromEnv = process.env[CLIENT_ID_ENV_VAR];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return asAzureClientId(fromEnv);
  throw new MinecraftKitError(
    MinecraftKitErrorCodes.AUTH_MISSING_CLIENT_ID,
    `No Azure AD client id supplied. Pass \`clientId\` explicitly or set ${CLIENT_ID_ENV_VAR}. Register an Azure AD application in the 'Personal Microsoft accounts' audience with XboxLive.signin + offline_access scopes to obtain one.`,
  );
};
