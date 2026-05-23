# Authentication

The kit ships a Microsoft OAuth 2.0 Authorization-Code + PKCE flow over a loopback redirect
that produces a Minecraft `accessToken` ready to drop into `kit.launch.compose`. Token
storage is the caller's job — the kit returns session objects, never persists them.

::: tip Stateless by design
`kit.auth.authorizationCode.run()` returns a `MojangSession` with the Minecraft profile
*and* the refresh token. Hand that to your launcher's storage layer; on next start, call
`kit.auth.refresh(refreshToken)` to mint a fresh access token.
:::

## Prerequisites

You need an Azure AD application id (Application/Client ID). Register one at
[https://portal.azure.com](https://portal.azure.com):

1. **Supported account types:** "Personal Microsoft accounts only" or "Accounts in any
   organisational directory and personal Microsoft accounts".
2. **Authentication → Allow public client flows:** Yes.
3. **Authentication → Platform configurations → Mobile and desktop applications → Add a
   platform:** add a redirect URI of `http://localhost` (no port, no path — the kit binds
   a random port at runtime).
4. Apply for Minecraft API access at
   [https://aka.ms/mce-reviewappid](https://aka.ms/mce-reviewappid) — without this,
   `login_with_xbox` rejects the token with `AUTH_MINECRAFT_FAILED`.

Pass the client id either explicitly or via the `MINECRAFT_KIT_MSA_CLIENT_ID` env var. The
kit refuses to ship a default — pinning your launcher to a single client id is a security
posture decision.

## Full sign-in

```ts
import { MinecraftKit } from "@loontail/minecraft-kit";

const kit = new MinecraftKit();

const session = await kit.auth.authorizationCode.run({
  clientId: process.env.MINECRAFT_KIT_MSA_CLIENT_ID,
  onOpenBrowser: async (url) => {
    // Open `url` in the user's system browser. In Electron:
    //   shell.openExternal(url)
    // In a CLI:
    //   import open from "open"; await open(url);
    // The kit deliberately does not assume how to open browsers — that
    // belongs to the host environment.
  },
  signal: abortController.signal,
});

console.log(session.minecraft.username);    // "Steve"
console.log(session.minecraft.uuid);        // dashed UUID
console.log(session.minecraft.accessToken); // → kit.launch.compose
console.log(session.microsoft.refreshToken); // ← persist this
console.log(session.microsoft.clientId);     // ← persist this too
```

The promise resolves only after the user finishes signing in in the browser (or rejects on
abort, decline, or `invalid_grant` — see [error codes](./errors)). The kit binds a loopback
HTTP server on a random port, hands the caller the Microsoft authorize URL, and waits for
Microsoft to redirect the browser back to `http://localhost:<port>` with the one-time code.

## Refresh

```ts
const refreshed = await kit.auth.refresh(savedRefreshToken, {
  clientId: savedClientId,
  signal: abortController.signal,
});
```

Microsoft may rotate the refresh token; check `refreshed.microsoft.refreshToken` against the
saved value and overwrite if changed.

## Plugging into launch

```ts
import { AuthModes, toOnlineAuth } from "@loontail/minecraft-kit";

const composition = await kit.launch.compose(target, {
  auth: toOnlineAuth(session),
});
const minecraft = kit.launch.run(composition);
```

`toOnlineAuth(session)` projects the session into the `OnlineAuth` shape with
`mode: AuthModes.ONLINE`, the player's uuid + username, the Mojang access token, the
client id, and the XUID extracted from the JWT.

## Skins and capes

`kit.auth.profile.*` calls `api.minecraftservices.com/minecraft/profile/{skins,capes}`
against the Mojang bearer in `session.minecraft.accessToken`. Every mutation returns
a fresh `MinecraftProfile` snapshot (uuid + username + every skin/cape slot with the
new `state`), so a launcher can refresh its skin/cape UI without an extra read.

```ts
import { MinecraftKit, type MinecraftProfile } from "@loontail/minecraft-kit";

const kit = new MinecraftKit();
const session = await kit.auth.authorizationCode.run({ onOpenBrowser });

// Apply a skin from a remote URL Mojang's servers can reach.
const a: MinecraftProfile = await kit.auth.profile.setSkinFromUrl({
  accessToken: session.minecraft.accessToken,
  url: "https://textures.minecraft.net/texture/abc...",
  variant: "CLASSIC", // or "SLIM" for the Alex model
});

// Upload a skin from a local PNG file.
import { readFile } from "node:fs/promises";
const b: MinecraftProfile = await kit.auth.profile.uploadSkin({
  accessToken: session.minecraft.accessToken,
  skin: await readFile("./my-skin.png"),
  variant: "SLIM",
});

// Drop back to the default Steve / Alex skin.
const c: MinecraftProfile = await kit.auth.profile.resetSkin({
  accessToken: session.minecraft.accessToken,
});

// Equip an owned cape by id (read ids from session.minecraft.capes).
const d: MinecraftProfile = await kit.auth.profile.equipCape({
  accessToken: session.minecraft.accessToken,
  capeId: session.minecraft.capes[0]!.id,
});

// Unequip the active cape (keeps it in the inventory).
const e: MinecraftProfile = await kit.auth.profile.unequipCape({
  accessToken: session.minecraft.accessToken,
});
```

All mutations are stateless — the kit never holds the access token between calls.
Pass the same `accessToken` you stored on the session. If the token has expired,
refresh it first with `kit.auth.refresh(session.microsoft.refreshToken)` and re-read
`session.minecraft.accessToken` from the returned session.

Errors:

- `AUTH_MINECRAFT_FAILED` on HTTP 401/403 — the access token expired or Mojang declined
  the request; refresh and retry.
- `AUTH_NO_GAME_OWNERSHIP` on HTTP 404 — the account does not own Java Edition.
- The PNG payload must be a 64×64 (or legacy 64×32) skin file. Mojang validates dimensions
  and returns a non-2xx that surfaces as `AUTH_MINECRAFT_FAILED`.

## Tracing

Pass a `Logger` to the kit constructor and the auth modules will emit `debug`-level
trace lines through `scopedLogger(logger, "auth")`. For a one-off CLI run without wiring
a logger:

```bash
MINECRAFT_KIT_AUTH_DEBUG=1 mckit
```

This routes auth trace to `consoleLogger` (stderr).

## Error taxonomy

See the [errors guide](./errors#authentication) for the full list. The common ones:

- `AUTH_MISSING_CLIENT_ID` — set the env var or pass `clientId`.
- `AUTH_AUTHORIZATION_CODE_FAILED` with `AADSTS7000218` in the message — flip "Allow public
  client flows" to Yes in Azure portal.
- `AUTH_AUTHORIZATION_CODE_DECLINED` — the user closed the browser without signing in, or
  Microsoft returned an OAuth `access_denied` / `invalid_grant` on the redirect.
- `AUTH_MINECRAFT_FAILED` mentioning `aka.ms/mce-reviewappid` — apply for Minecraft API
  access for this Azure AD app.
- `AUTH_NO_GAME_OWNERSHIP` — the Microsoft account does not own Java Edition (or the wrong
  account is signed into the browser).
- `AUTH_XSTS_FAILED` with `xerr === 2148916233` — the account never used Xbox Live; sign in
  once at [https://www.xbox.com](https://www.xbox.com) and retry.
- `AUTH_CANCELLED` — the caller aborted via `signal`.
