# Skins

`kit.auth.profile.*` wraps the `api.minecraftservices.com/minecraft/profile/skins`
endpoints — set a skin from URL, upload a local PNG, or reset to the default. These are
profile mutations, not part of the sign-in flow; they only live under `kit.auth` because
they share its Minecraft bearer token (`session.minecraft.accessToken`).

Every mutation returns a fresh `MinecraftProfile` snapshot (uuid + username + every skin
slot with the new `state`), so a launcher can refresh its UI without an extra read.

::: tip Capes aren't here
Mojang's API does not expose any way to upload or change capes from a launcher — capes
are issued by Mojang (MineCon, Migrator, etc.) and chosen client-side. The kit therefore
has no cape API.
:::

## Prerequisites

You need a signed-in `MojangSession` — see the [authentication guide](./auth). All three
methods take `accessToken: session.minecraft.accessToken` and nothing else
session-related.

## Set a skin from a URL

Tells Mojang to fetch the PNG from a publicly-reachable URL.

```ts
import type { MinecraftProfile } from "@loontail/minecraft-kit";

const profile: MinecraftProfile = await kit.auth.profile.setSkinFromUrl({
  accessToken: session.minecraft.accessToken,
  url: "https://textures.minecraft.net/texture/abc...",
  variant: "CLASSIC", // or "SLIM" for the Alex model
});
```

The URL must be reachable from Mojang's servers — private or localhost URLs fail on
Mojang's side. Use `uploadSkin` for local files.

## Upload a skin from local PNG bytes

```ts
import { readFile } from "node:fs/promises";

const profile = await kit.auth.profile.uploadSkin({
  accessToken: session.minecraft.accessToken,
  skin: await readFile("./my-skin.png"),
  variant: "SLIM",
  // fileName: "alex.png", // optional, defaults to "skin.png"
});
```

The PNG must be a valid 64×64 (or legacy 64×32) skin file. Mojang validates the
dimensions; an out-of-spec image surfaces as `AUTH_MINECRAFT_FAILED`.

## Reset to the default skin

Drops the active skin and reverts to Steve / Alex (picked from the player UUID). The
previously active skin remains in the list with `state: "INACTIVE"`.

```ts
const profile = await kit.auth.profile.resetSkin({
  accessToken: session.minecraft.accessToken,
});
```

## Reading the returned profile

```ts
const active = profile.skins.find((s) => s.state === "ACTIVE");
console.log(active?.url, active?.variant);
```

Types: [`MinecraftProfile`](../api/type-aliases/MinecraftProfile),
[`MojangProfileSkin`](../api/type-aliases/MojangProfileSkin),
[`MojangSkinVariant`](../api/type-aliases/MojangSkinVariant) (`"CLASSIC" | "SLIM"`).

## Errors

- `AUTH_MINECRAFT_FAILED` on HTTP 401/403 — the access token expired or Mojang rejected
  the request. Refresh the session with `kit.auth.refresh(session.microsoft.refreshToken)`
  and retry with the new `session.minecraft.accessToken`.
- `AUTH_NO_GAME_OWNERSHIP` on HTTP 404 — the account does not own Java Edition.
- `AUTH_MINECRAFT_FAILED` from skin uploads usually means the PNG failed Mojang's
  dimension check (must be 64×64 or 64×32).

The kit never holds the access token between calls — pass the same token you stored on
the session each time.
