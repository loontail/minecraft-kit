# @loontail/minecraft-kit

A stateless TypeScript Minecraft launcher library and interactive CLI for vanilla, Fabric,
and Forge.

**Documentation:** https://loontail.github.io/minecraft-kit/

## Features

- Install vanilla Minecraft, Fabric, Forge, and Mojang Java runtimes.
- Verify and repair only missing or corrupt files.
- Launch with offline auth or Microsoft OAuth 2.0 Authorization Code + PKCE.
- Mutate Mojang skins through `kit.auth.profile.*`.
- Consume typed progress events for downloads, integrity checks, Forge processors, and launch.
- Use the interactive `mckit` CLI for the same flows.
- Stay stateless: the kit writes Minecraft files only; token/profile persistence belongs to
  the host launcher.

## Install

```bash
npm install @loontail/minecraft-kit
```

Requires Node ≥ 22.12.

## Usage

```ts
import {
  asMinecraftVersionId,
  AuthModes,
  Loaders,
  MinecraftKit,
  SkinVariants,
} from "@loontail/minecraft-kit";

const kit = new MinecraftKit();

const target = await kit.targets.resolve({
  id: "fabric-client",
  directory: "./minecrafts/fabric-client",
  minecraft: { version: asMinecraftVersionId("1.20.1") },
  loader: { type: Loaders.FABRIC },
});

const plan = await kit.install.plan(target);
await kit.install.run(plan);

const composition = await kit.launch.compose(target, {
  auth: { mode: AuthModes.OFFLINE, username: "Player" },
});
const session = kit.launch.run(composition);
await session.exited;
```

### Online launch via Microsoft

The kit speaks OAuth 2.0 Authorization Code + PKCE with a loopback redirect. You hand it a
callback that opens the URL in the user's browser; everything else — random-port loopback
server, state / code-verifier handling, Microsoft → Xbox → XSTS → Minecraft pipeline — is
internal. Tokens are returned in memory; persistence is the launcher's job.

```ts
import {
  asAzureClientId,
  asMicrosoftRefreshToken,
  MinecraftKit,
  toOnlineAuth,
} from "@loontail/minecraft-kit";

const kit = new MinecraftKit();
const clientId = asAzureClientId(process.env.MINECRAFT_KIT_MSA_CLIENT_ID ?? "");

// First sign-in.
const session = await kit.auth.authorizationCode.run({
  clientId,
  onOpenBrowser: async (url) => {
    // Open `url` in the user's browser (shell.openExternal in Electron, `open`
    // in a CLI). Optional `successHtml` lets you customise the post-redirect page.
  },
});
await persistRefreshToken(session.microsoft.refreshToken); // your storage

// On a later run: refresh instead of re-prompting.
const fresh = await kit.auth.refresh(
  asMicrosoftRefreshToken(await loadRefreshToken()),
  { clientId },
);

const composition = await kit.launch.compose(target, {
  auth: toOnlineAuth(fresh),
});
```

### Validate a cached access token

`kit.auth.profile.read({ accessToken })` GETs `/minecraft/profile` and returns the player
profile — use it to confirm a cached Minecraft access token is still usable without
spending a Microsoft refresh token. A 2xx confirms; a 401/403 surfaces as
`AUTH_MINECRAFT_FAILED` (call `kit.auth.refresh` and retry with the new
`session.minecraft.accessToken`); a 404 surfaces as `AUTH_NO_GAME_OWNERSHIP`.

```ts
const profile = await kit.auth.profile.read({
  accessToken: session.minecraft.accessToken,
});
console.log(profile.username, profile.uuid);
```

### Skins

Every method on `kit.auth.profile.*` takes the Mojang bearer
(`session.minecraft.accessToken`) and returns the updated `MinecraftProfile` snapshot —
no extra GET round-trip needed to refresh launcher UI.

```ts
import { readFile } from "node:fs/promises";

// Apply a skin Mojang fetches from a public URL.
await kit.auth.profile.setSkinFromUrl({
  accessToken: session.minecraft.accessToken,
  url: "https://textures.minecraft.net/texture/abc...",
  variant: SkinVariants.CLASSIC,
});

// Upload a local PNG.
await kit.auth.profile.uploadSkin({
  accessToken: session.minecraft.accessToken,
  skin: await readFile("./alex.png"),
  variant: SkinVariants.SLIM,
});

// Drop back to Steve / Alex.
await kit.auth.profile.resetSkin({ accessToken: session.minecraft.accessToken });
```

Capes are not exposed — Mojang's API doesn't allow launchers to set custom capes
(only Mojang-issued ones like Migrator / MineCon), so the kit ships no cape API.

See [Skins](https://loontail.github.io/minecraft-kit/guides/skins).

## CLI

```bash
mckit
```

The CLI is fully interactive — no required arguments. Run inside the directory that should
host your installations. Flags: `--help`, `--version`, `--debug`.

## License

MIT
