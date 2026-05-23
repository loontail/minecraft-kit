# @loontail/minecraft-kit

A stateless TypeScript Minecraft launcher library and interactive CLI for vanilla, Fabric,
and modern Forge.

**Documentation:** https://loontail.github.io/minecraft-kit/

## Features

- **Install** vanilla Minecraft, Fabric, and modern Forge end-to-end.
- **Java runtimes** — install Mojang's `java-runtime-gamma` / `delta` / `jre-legacy` /
  others, either bundled with a target or standalone.
- **Verify, repair, launch.** Per-aspect verifiers tell you exactly which files are missing
  or corrupted; repair re-downloads only those.
- **Microsoft OAuth.** Built-in Microsoft sign-in (OAuth 2.0 Authorization Code + PKCE)
  with a loopback redirect returns a `MojangSession` ready for online launches.
  Refresh, switch account, sign out — all without persisting tokens; that stays in your
  launcher's hands.
- **Skin management.** `kit.auth.profile.*` — set a skin from URL or PNG bytes, or
  reset to the default Steve / Alex. Every mutation returns the updated
  `MinecraftProfile` so launcher UIs refresh without an extra read.
- **Typed events.** Discriminated-union `onEvent` callbacks cover every download, integrity
  check, archive extraction, processor invocation, and launch transition.
- **Defence in depth.** URL scheme allow-list on every download, optional host pinning,
  manifest shape validation, zip-bomb caps, zip-slip rejection, atomic writes.
- **Interactive CLI** (`mckit`) — install / verify / repair / launch / sign-in from a single
  menu.
- **Stateless** — writes only the files Minecraft itself needs; no profile registry, no
  session files, no launcher-private metadata.

## Install

```bash
npm install @loontail/minecraft-kit
```

Requires Node ≥ 20.11.

## Usage

```ts
import {
  asMinecraftVersionId,
  AuthModes,
  Loaders,
  MinecraftKit,
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
  variant: "CLASSIC", // or "SLIM" for the Alex model
});

// Upload a local PNG.
await kit.auth.profile.uploadSkin({
  accessToken: session.minecraft.accessToken,
  skin: await readFile("./alex.png"),
  variant: "SLIM",
});

// Drop back to Steve / Alex.
await kit.auth.profile.resetSkin({ accessToken: session.minecraft.accessToken });
```

Capes are not exposed — Mojang's API doesn't allow launchers to set custom capes
(only Mojang-issued ones like Migrator / MineCon), so the kit ships no cape API.

See [docs/guides/skins](https://loontail.github.io/minecraft-kit/guides/skins) for the
full surface and error taxonomy.

## CLI

```bash
mckit
```

The CLI is fully interactive — no required arguments. Run inside the directory that should
host your installations. Flags: `--help`, `--version`, `--debug`.

## License

MIT
