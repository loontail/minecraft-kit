# Authentication

The kit ships a Microsoft OAuth 2.0 Authorization-Code + PKCE flow over a loopback
redirect that produces a Minecraft `accessToken` ready for `kit.launch.compose`. Tokens
never touch disk inside the kit — persisting the refresh token is the caller's job.

::: tip Stateless by design
`kit.auth.authorizationCode.run()` returns a `MojangSession` with the Minecraft profile
*and* the Microsoft refresh token. Hand the refresh token to your launcher's storage; on
next start, call `kit.auth.refresh(refreshToken)` to mint a fresh access token.
:::

## Prerequisites

You need an Azure AD application id (Application / Client ID). Register one at
[portal.azure.com](https://portal.azure.com):

1. **Supported account types:** "Personal Microsoft accounts only" or "Accounts in any
   organisational directory and personal Microsoft accounts".
2. **Authentication → Allow public client flows:** Yes.
3. **Authentication → Platform configurations → Mobile and desktop applications → Add a
   platform:** add `http://localhost` as a redirect URI (no port, no path — the kit binds
   a random port at runtime).
4. Apply for Minecraft API access at
   [aka.ms/mce-reviewappid](https://aka.ms/mce-reviewappid) — without this,
   `login_with_xbox` rejects the token with `AUTH_MINECRAFT_FAILED`.

Pass the client id either explicitly or via the `MINECRAFT_KIT_MSA_CLIENT_ID` env var.
The kit refuses to ship a default — pinning your launcher to a single client id is a
security-posture decision.

## Sign in

```ts
import { asAzureClientId, MinecraftKit } from "@loontail/minecraft-kit";

const kit = new MinecraftKit();
const clientId = asAzureClientId(process.env.MINECRAFT_KIT_MSA_CLIENT_ID ?? "");

const session = await kit.auth.authorizationCode.run({
  clientId,
  onOpenBrowser: async (url) => {
    // Open `url` in the user's system browser.
    //   Electron: shell.openExternal(url)
    //   CLI:      import open from "open"; await open(url);
    // Opening browsers belongs to the host environment.
  },
  signal: abortController.signal,
});

console.log(session.minecraft.username);     // "Steve"
console.log(session.minecraft.uuid);         // dashed UUID
console.log(session.minecraft.accessToken);  // → kit.launch.compose
console.log(session.microsoft.refreshToken); // ← persist this
console.log(session.microsoft.clientId);     // ← persist this too
```

The promise resolves after browser sign-in, or rejects on abort/decline/token failure.
Internally the kit:

1. Binds a loopback HTTP server on `127.0.0.1:<random>`.
2. Hands you the Microsoft authorize URL via `onOpenBrowser`.
3. Waits for Microsoft to redirect the browser back with the one-time code.
4. Walks the Microsoft → Xbox → XSTS → Minecraft pipeline.
5. Returns the combined `MojangSession`.

## Refresh

```ts
const refreshed = await kit.auth.refresh(savedRefreshToken, {
  clientId: savedClientId,
  signal: abortController.signal,
});
```

Microsoft may rotate the refresh token; compare `refreshed.microsoft.refreshToken`
against the saved value and overwrite if it changed.

## Plug into launch

```ts
import { toOnlineAuth } from "@loontail/minecraft-kit";

const composition = await kit.launch.compose(target, {
  auth: toOnlineAuth(session),
});
const minecraft = kit.launch.run(composition);
```

`toOnlineAuth(session)` projects the session into the `OnlineAuth` shape.

## Validate a cached access token

`kit.auth.profile.read({ accessToken })` GETs `/minecraft/profile` and returns the same
`MinecraftProfile` shape sign-in produces. Use it to confirm a cached Minecraft access
token is still good without spending a Microsoft refresh token: a 2xx confirms the token
is usable; 401/403 surfaces as `AUTH_MINECRAFT_FAILED` (call `kit.auth.refresh` and retry
with the new `session.minecraft.accessToken`); 404 surfaces as `AUTH_NO_GAME_OWNERSHIP`.

```ts
const profile = await kit.auth.profile.read({
  accessToken: session.minecraft.accessToken,
});
console.log(profile.username, profile.uuid);
```

## Skins

`kit.auth.profile.*` lives next to auth because it reuses the Minecraft bearer, but it's
a separate concern — see the [skins guide](./skins) for set/upload/reset skins. (Capes
are not exposed; Mojang's API does not let launchers change them.)

## Tracing

Pass a `Logger` to the kit constructor and the auth modules emit `debug`-level trace
lines through `scopedLogger(logger, "auth")`. For a one-off CLI run without wiring a
logger:

```bash
MINECRAFT_KIT_AUTH_DEBUG=1 mckit
```

This routes auth trace to `consoleLogger` (stderr).

## Error taxonomy

See the [errors guide](./errors#authentication) for the full list. The common ones:

- `AUTH_MISSING_CLIENT_ID` — set the env var or pass `clientId`.
- `AUTH_AUTHORIZATION_CODE_FAILED` with `AADSTS7000218` in the message — flip "Allow
  public client flows" to Yes in Azure portal.
- `AUTH_AUTHORIZATION_CODE_DECLINED` — the user closed the browser without signing in,
  or Microsoft returned `access_denied` / `invalid_grant` on the redirect.
- `AUTH_MINECRAFT_FAILED` mentioning `aka.ms/mce-reviewappid` — apply for Minecraft API
  access for this Azure AD app.
- `AUTH_NO_GAME_OWNERSHIP` — the Microsoft account does not own Java Edition (or the
  wrong account is signed into the browser).
- `AUTH_XSTS_FAILED` with `xerr === 2148916233` — the account never used Xbox Live; sign
  in once at [xbox.com](https://www.xbox.com) and retry.
- `AUTH_CANCELLED` — the caller aborted via `signal`.
