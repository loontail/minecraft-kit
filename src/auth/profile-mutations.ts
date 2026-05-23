import { randomBytes } from "node:crypto";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { withOptionalSignal } from "../core/optional";
import { isHttpOk } from "../http/status";
import type { MinecraftProfile, MojangSkinVariant } from "../types/auth";
import type { HttpClient, HttpResponse } from "../types/http";
import {
  MINECRAFT_KIT_USER_AGENT,
  type RawProfileResponse,
  parseProfileResponse,
} from "./minecraft";
import { type MojangSkinVariantInput, detectMojangSkinVariant } from "./skin-variant-detect";

const PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";
const SKIN_URL = `${PROFILE_URL}/skins`;
const ACTIVE_SKIN_URL = `${PROFILE_URL}/skins/active`;

/**
 * Common headers for every profile-mutation call. Mojang silently 403s
 * requests missing the launcher-style user-agent (same trick the read-path
 * uses).
 *
 * @internal
 */
const authHeaders = (
  accessToken: string,
  extra?: Record<string, string>,
): Record<string, string> => ({
  authorization: `Bearer ${accessToken}`,
  accept: "application/json",
  "user-agent": MINECRAFT_KIT_USER_AGENT,
  ...(extra ?? {}),
});

/** Max chars of Mojang's response body to embed in the error message. */
const ERROR_BODY_MAX_CHARS = 400;

/**
 * Surface every profile-mutation maps an unexpected non-2xx onto. `404` is
 * specifically called out because Mojang returns it when the access token
 * is valid but the account doesn't own Java Edition — the message should
 * tell the user that, not "HTTP 404".
 *
 * Reads the response body once (best-effort — if it fails or is empty, we
 * just omit it) and embeds it in both the error message and the context so
 * callers can show Mojang's actual rejection reason instead of a generic
 * "HTTP 400". Mojang typically returns a JSON `{path, errorType, error,
 * errorMessage, developerMessage}` for skin/profile rejections.
 */
const throwOnNonOk = async (response: HttpResponse): Promise<void> => {
  const status = response.status;
  if (isHttpOk(status)) return;
  const body = await response.text().catch(() => "");
  const trimmed = body.trim();
  const detail = trimmed.length > 0 ? `: ${trimmed.slice(0, ERROR_BODY_MAX_CHARS)}` : "";
  const context = { httpStatus: status, ...(trimmed.length > 0 ? { responseBody: trimmed } : {}) };
  if (status === 401 || status === 403) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_MINECRAFT_FAILED,
      `Mojang rejected the profile mutation (HTTP ${status}). The access token may have expired — refresh the session and retry${detail}`,
      { context },
    );
  }
  if (status === 404) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.AUTH_NO_GAME_OWNERSHIP,
      `This Microsoft account does not own Minecraft: Java Edition${detail}`,
      { context },
    );
  }
  throw new MinecraftKitError(
    MinecraftKitErrorCodes.AUTH_MINECRAFT_FAILED,
    `Profile mutation failed (HTTP ${status})${detail}`,
    { context },
  );
};

/**
 * Inputs to {@link setSkinFromUrl}.
 *
 * @example
 * ```ts
 * import type { SetSkinFromUrlInput } from "@loontail/minecraft-kit";
 *
 * const input: SetSkinFromUrlInput = {
 *   accessToken: session.minecraft.accessToken,
 *   url: "https://textures.minecraft.net/texture/<hash>",
 *   variant: "CLASSIC",
 * };
 * ```
 */
export type SetSkinFromUrlInput = {
  /** Minecraft bearer (`session.minecraft.accessToken`). */
  readonly accessToken: string;
  /** Publicly-reachable URL Mojang will download the skin PNG from. */
  readonly url: string;
  /** Skin model variant — `"CLASSIC"` for standard arms, `"SLIM"` for Alex. */
  readonly variant: MojangSkinVariant;
  readonly signal?: AbortSignal;
};

/**
 * POST `/minecraft/profile/skins` with `{variant, url}` — tells Mojang to
 * fetch the texture from `url` and set it as the active skin.
 *
 * The URL must be reachable from Mojang's servers; private / localhost URLs
 * will fail with a Mojang-side error. Use {@link uploadSkin} for local files.
 *
 * Returns the updated {@link MinecraftProfile} snapshot — call this in a
 * launcher to refresh the skin list shown to the user.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const profile = await kit.auth.profile.setSkinFromUrl({
 *   accessToken: session.minecraft.accessToken,
 *   url: "https://textures.minecraft.net/texture/abc...",
 *   variant: "CLASSIC",
 * });
 * console.log(profile.skins.find((s) => s.state === "ACTIVE")?.url);
 * ```
 */
export const setSkinFromUrl = async (
  http: HttpClient,
  input: SetSkinFromUrlInput,
): Promise<MinecraftProfile> => {
  const response = await http.request(SKIN_URL, {
    method: "POST",
    headers: authHeaders(input.accessToken, { "content-type": "application/json" }),
    body: JSON.stringify({ variant: input.variant.toLowerCase(), url: input.url }),
    acceptNonOk: true,
    ...withOptionalSignal(input.signal),
  });
  await throwOnNonOk(response);
  return parseProfileResponse((await response.json()) as RawProfileResponse);
};

/**
 * Inputs to {@link uploadSkin}.
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import type { UploadSkinInput } from "@loontail/minecraft-kit";
 *
 * const input: UploadSkinInput = {
 *   accessToken: session.minecraft.accessToken,
 *   skin: await readFile("./my-skin.png"),
 *   variant: "SLIM",
 * };
 * ```
 */
export type UploadSkinInput = {
  /** Minecraft bearer (`session.minecraft.accessToken`). */
  readonly accessToken: string;
  /** Raw PNG bytes of the skin (64×64 or 64×32 pixels per Mojang's rules). */
  readonly skin: Uint8Array;
  /**
   * Skin model variant — `"CLASSIC"` for standard arms, `"SLIM"` for Alex,
   * or `"AUTO"` to pick the variant by inspecting the PNG pixels (see
   * {@link detectMojangSkinVariant}).
   */
  readonly variant: MojangSkinVariantInput;
  /** Optional `filename` part of the multipart entry. Defaults to `"skin.png"`. */
  readonly fileName?: string;
  readonly signal?: AbortSignal;
};

/**
 * POST `/minecraft/profile/skins` as `multipart/form-data` — uploads the
 * skin PNG bytes directly. Use this for local files; use
 * {@link setSkinFromUrl} when the texture already lives on a public URL.
 *
 * Returns the updated {@link MinecraftProfile} snapshot.
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const profile = await kit.auth.profile.uploadSkin({
 *   accessToken: session.minecraft.accessToken,
 *   skin: await readFile("./alex.png"),
 *   variant: "SLIM",
 * });
 * ```
 */
export const uploadSkin = async (
  http: HttpClient,
  input: UploadSkinInput,
): Promise<MinecraftProfile> => {
  const variant: MojangSkinVariant =
    input.variant === "AUTO" ? detectMojangSkinVariant(input.skin) : input.variant;
  const { body, contentType } = buildSkinMultipart(
    variant.toLowerCase(),
    input.skin,
    input.fileName ?? "skin.png",
  );
  const response = await http.request(SKIN_URL, {
    method: "POST",
    headers: authHeaders(input.accessToken, { "content-type": contentType }),
    body,
    acceptNonOk: true,
    ...withOptionalSignal(input.signal),
  });
  await throwOnNonOk(response);
  return parseProfileResponse((await response.json()) as RawProfileResponse);
};

/**
 * Inputs to {@link resetSkin}.
 *
 * @example
 * ```ts
 * import type { ResetSkinInput } from "@loontail/minecraft-kit";
 *
 * const input: ResetSkinInput = { accessToken: session.minecraft.accessToken };
 * ```
 */
export type ResetSkinInput = {
  /** Minecraft bearer (`session.minecraft.accessToken`). */
  readonly accessToken: string;
  readonly signal?: AbortSignal;
};

/**
 * DELETE `/minecraft/profile/skins/active` — drops the active skin and
 * reverts to Mojang's default (Steve or Alex, picked from the player UUID).
 *
 * Returns the updated {@link MinecraftProfile} snapshot — the previously
 * active skin will appear in the list with `state: "INACTIVE"`.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const profile = await kit.auth.profile.resetSkin({
 *   accessToken: session.minecraft.accessToken,
 * });
 * console.log(profile.skins.filter((s) => s.state === "ACTIVE")); // → []
 * ```
 */
export const resetSkin = async (
  http: HttpClient,
  input: ResetSkinInput,
): Promise<MinecraftProfile> => {
  const response = await http.request(ACTIVE_SKIN_URL, {
    method: "DELETE",
    headers: authHeaders(input.accessToken),
    acceptNonOk: true,
    ...withOptionalSignal(input.signal),
  });
  await throwOnNonOk(response);
  return parseProfileResponse((await response.json()) as RawProfileResponse);
};

/**
 * Build a `multipart/form-data` body with a fresh random boundary. The
 * `variant` field carries the model variant (`"classic"` / `"slim"`) and
 * the `file` field carries the PNG bytes — that is the shape Mojang's
 * skin-upload endpoint expects.
 */
const buildSkinMultipart = (
  variant: string,
  png: Uint8Array,
  filename: string,
): { body: Uint8Array; contentType: string } => {
  const boundary = `----minecraft-kit-${randomBytes(16).toString("hex")}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="variant"\r\n\r\n${variant}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + png.length + tail.length);
  body.set(head, 0);
  body.set(png, head.length);
  body.set(tail, head.length + png.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
};
