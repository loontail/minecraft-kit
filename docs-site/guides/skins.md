# Skins

`kit.auth.profile` exposes three skin mutations against Mojang:

- `setSkinFromUrl`
- `uploadSkin`
- `resetSkin`

All methods use `session.minecraft.accessToken` and return an updated
`MinecraftProfile` with a fresh `skins` list.

::: tip
Mojang exposes no cape upload endpoint for launchers. Handle capes on the client side only.
:::

## Prerequisites

`MojangSession` with `session.minecraft.accessToken` from the auth flow.

## Set a skin from URL

```ts
import type { MinecraftProfile } from "@loontail/minecraft-kit";

const profile: MinecraftProfile = await kit.auth.profile.setSkinFromUrl({
  accessToken: session.minecraft.accessToken,
  url: "https://textures.minecraft.net/texture/abc...",
  variant: "CLASSIC", // or "SLIM"
});
```

The endpoint accepts only publicly reachable URLs.

## Upload local PNG

```ts
import { readFile } from "node:fs/promises";

const profile = await kit.auth.profile.uploadSkin({
  accessToken: session.minecraft.accessToken,
  skin: await readFile("./my-skin.png"),
  variant: "AUTO", // "AUTO" detects model from pixels; "CLASSIC"/"SLIM" are explicit
  // fileName: "alex.png"
});
```

`uploadSkin` accepts `64x64` or legacy `64x32` PNGs. Other dimensions throw
`AUTH_MINECRAFT_FAILED`.

## Reset to default

```ts
const profile = await kit.auth.profile.resetSkin({
  accessToken: session.minecraft.accessToken,
});
```

This sets the player skin back to the default and marks the previous one `INACTIVE`.

## Readback pattern

```ts
const active = profile.skins.find((s) => s.state === "ACTIVE");
console.log(active?.url, active?.variant);
```

Types:

- [`MinecraftProfile`](../api/type-aliases/MinecraftProfile),
- [`MojangProfileSkin`](../api/type-aliases/MojangProfileSkin),
- [`MojangSkinVariant`](../api/type-aliases/MojangSkinVariant).

## Errors

- `AUTH_MINECRAFT_FAILED`: expired token, wrong scope, or invalid PNG dimensions.
- `AUTH_NO_GAME_OWNERSHIP`: account does not own Java Edition.

Refresh using `kit.auth.refresh(session.microsoft.refreshToken)` on auth failures and retry.
