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
import { SkinVariants, type MinecraftProfile } from "@loontail/minecraft-kit";

const profile: MinecraftProfile = await kit.auth.profile.setSkinFromUrl({
  accessToken: session.minecraft.accessToken,
  url: "https://textures.minecraft.net/texture/abc...",
  variant: SkinVariants.CLASSIC,
});
```

The endpoint accepts only publicly reachable URLs.

## Upload local PNG

```ts
import { SkinVariantInputs } from "@loontail/minecraft-kit";
import { readFile } from "node:fs/promises";

const profile = await kit.auth.profile.uploadSkin({
  accessToken: session.minecraft.accessToken,
  skin: await readFile("./my-skin.png"),
  variant: SkinVariantInputs.AUTO,
  // fileName: "alex.png"
});
```

`SkinVariantInputs.AUTO` detects the model from pixels. Use `SkinVariants.CLASSIC` or
`SkinVariants.SLIM` to force it. `uploadSkin` accepts `64x64` and legacy `64x32` PNGs.

## Reset to default

```ts
const profile = await kit.auth.profile.resetSkin({
  accessToken: session.minecraft.accessToken,
});
```

This sets the player skin back to the default and marks the previous one
`MojangAssetStates.INACTIVE`.

## Readback pattern

```ts
import { MojangAssetStates } from "@loontail/minecraft-kit";

const active = profile.skins.find((s) => s.state === MojangAssetStates.ACTIVE);
console.log(active?.url, active?.variant);
```

Types:

- [`MinecraftProfile`](../api/type-aliases/MinecraftProfile),
- [`MojangProfileSkin`](../api/type-aliases/MojangProfileSkin),
- [`SkinVariant`](../api/type-aliases/SkinVariant),
- [`SkinVariantInput`](../api/type-aliases/SkinVariantInput).

## Errors

- `AUTH_MINECRAFT_FAILED`: expired token, wrong scope, or Mojang rejected the PNG.
- `AUTH_NO_GAME_OWNERSHIP`: account does not own Java Edition.

Refresh using `kit.auth.refresh(session.microsoft.refreshToken)` on auth failures and retry.
