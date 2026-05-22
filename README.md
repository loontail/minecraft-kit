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
  returns a `MojangSession` ready for online launches. Token storage stays in your
  launcher's hands.
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
import { MinecraftKit, AuthModes, Loaders } from "@loontail/minecraft-kit";

const kit = new MinecraftKit();

const target = await kit.targets.resolve({
  id: "fabric-client",
  directory: "./minecrafts/fabric-client",
  minecraft: { version: "1.20.1" },
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

```ts
const session = await kit.auth.authorizationCode.run({
  clientId: process.env.MINECRAFT_KIT_MSA_CLIENT_ID,
  onOpenBrowser: async (url) => {
    // Open `url` in the user's browser (shell.openExternal in Electron, `open` in a CLI).
  },
});

// Persist `session.microsoft.refreshToken` somewhere your launcher controls.
// Next start: kit.auth.refresh(savedRefreshToken).

const composition = await kit.launch.compose(target, {
  auth: toOnlineAuth(session),
});
```

See [docs/guides/auth](https://loontail.github.io/minecraft-kit/guides/auth) for Azure AD
registration steps and the full error taxonomy.

## CLI

```bash
mckit
```

The CLI is fully interactive — no required arguments. Run inside the directory that should
host your installations. Flags: `--help`, `--version`, `--debug`.

## Security

The kit goes through three defence layers on untrusted input. See
[docs/guides/security](https://loontail.github.io/minecraft-kit/guides/security) for the
full model. Highlights:

- Downloads accept only `http(s)` URLs; opt-in `hostAllowList` pins to a known set of hosts.
- Manifests pass through runtime shape guards before any code trusts them.
- Zip extraction caps entry count, per-entry size, total size, and compression ratio;
  rejects path traversal, null bytes, reserved Windows names, and drive letters.
- Auth tokens never touch disk inside the kit. `kit.auth.authorizationCode.run()` returns
  a session; the launcher decides how to persist the refresh token.

## License

MIT
