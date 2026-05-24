/**
 * Public option types accepted by {@link MojangAuthApi.refresh} and
 * `kit.auth.authorizationCode.run`. Lives in its own module so the {@link "./index"}
 * facade stays focused on the class itself plus the assembly that wires loopback,
 * token exchange, and the pipeline together.
 *
 * @packageDocumentation
 */

import type { AzureClientId } from "../types/auth";

/**
 * Options accepted by `kit.auth.refresh`.
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
