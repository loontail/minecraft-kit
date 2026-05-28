# Quickstart

Two launch modes:

- **Offline** — no Microsoft account needed; can't connect to online servers.
- **Online** — full Microsoft sign-in via OAuth 2.0 Authorization Code + PKCE; returns a
  Mojang session that the launch composer plugs straight in.

## Offline launch

```ts
import { MinecraftKit, AuthModes, Loaders, EventTypes } from "@loontail/minecraft-kit";

const kit = new MinecraftKit();

// 1. Resolve a target — Minecraft 1.20.1 with the latest stable Fabric loader.
const target = await kit.targets.resolve({
  id: "fabric-client",
  directory: "./minecrafts/fabric-client",
  minecraft: { version: "1.20.1" },
  loader: { type: Loaders.FABRIC },
});

// 2. Plan the install. No disk writes happen here apart from the Forge installer
//    (Fabric and vanilla skip the disk during planning).
const plan = await kit.install.plan(target);
console.log(`${plan.totalActions} actions, ${plan.totalBytes} bytes`);

// 3. Execute the plan. Downloads run in parallel; files already on disk are skipped.
await kit.install.run(plan, {
  onEvent: (e) => {
    if (e.type === EventTypes.INSTALL_PHASE_CHANGED) console.log("phase:", e.phase);
  },
});

// 4. Launch with an offline username.
const composition = await kit.launch.compose(target, {
  auth: { mode: AuthModes.OFFLINE, username: "Player" },
  memory: { minMb: 1024, maxMb: 4096 },
});
const session = kit.launch.run(composition);
await session.exited;
```

## Online launch with Microsoft sign-in

The kit ships a complete OAuth 2.0 Authorization-Code + PKCE flow over a loopback
redirect and returns a `MojangSession` ready for `kit.launch.compose`. Tokens never
touch disk inside the kit — **persisting the refresh token is your launcher's job**.

```ts
import {
  asAzureClientId,
  asMicrosoftRefreshToken,
  MinecraftKit,
  Loaders,
  toOnlineAuth,
} from "@loontail/minecraft-kit";
import fs from "node:fs/promises";

const kit = new MinecraftKit();
const clientId = asAzureClientId(process.env.MINECRAFT_KIT_MSA_CLIENT_ID ?? "");

// 1. Sign in. Reuse a saved refresh token if available, otherwise prompt.
const saved = await readSavedSession();
const session = saved
  ? await kit.auth.refresh(asMicrosoftRefreshToken(saved.refreshToken), {
      clientId: asAzureClientId(saved.clientId),
    })
  : await kit.auth.authorizationCode.run({
      clientId,
      onOpenBrowser: async (url) => {
        // Open `url` in the user's system browser:
        //   Electron: shell.openExternal(url)
        //   CLI:      await import("open").then((o) => o.default(url))
        // The kit waits for Microsoft's loopback redirect.
        console.log(`Open ${url} in your browser to sign in.`);
      },
    });

// 2. Persist refresh token + client id for next start.
//    `session.minecraft.accessToken` is short-lived; do not cache it.
await saveSession({
  refreshToken: session.microsoft.refreshToken,
  clientId: session.microsoft.clientId,
});

console.log(`Signed in as ${session.minecraft.username}`);

// 3. Resolve the same target as the offline example.
const target = await kit.targets.resolve({
  id: "fabric-client",
  directory: "./minecrafts/fabric-client",
  minecraft: { version: "1.20.1" },
  loader: { type: Loaders.FABRIC },
});
await kit.install.run(await kit.install.plan(target));

// 4. Launch with the online session projected into the OnlineAuth shape.
const composition = await kit.launch.compose(target, {
  auth: toOnlineAuth(session),
  memory: { minMb: 1024, maxMb: 4096 },
});
const minecraft = kit.launch.run(composition);
await minecraft.exited;

// --- helpers (your launcher's own storage; nothing the kit ships) ---
async function readSavedSession(): Promise<{ refreshToken: string; clientId: string } | null> {
  try {
    return JSON.parse(await fs.readFile("./session.json", "utf8"));
  } catch {
    return null;
  }
}
async function saveSession(data: { refreshToken: string; clientId: string }): Promise<void> {
  await fs.writeFile("./session.json", JSON.stringify(data, null, 2));
}
```

### Prerequisites for online launch

`kit.auth.authorizationCode.run` requires an Azure AD application id:

1. Register an app at [portal.azure.com](https://portal.azure.com) → **App registrations**.
2. Set **Supported account types** to "Personal Microsoft accounts only" (or the variant
   that includes them).
3. Authentication → **Allow public client flows: Yes**.
4. Authentication → **Platform configurations → Mobile and desktop applications → Add a
   platform:** add `http://localhost` as a redirect URI (no port, no path — the kit
   binds a random port at runtime).
5. Request Minecraft API access at
   [aka.ms/mce-reviewappid](https://aka.ms/mce-reviewappid). Without this,
   `login_with_xbox` rejects the token.

Pass the Application (client) ID via `MINECRAFT_KIT_MSA_CLIENT_ID` or the `clientId`
option. The kit refuses to ship a default — `AUTH_MISSING_CLIENT_ID` is thrown when
neither is set.

More auth details are in [Authentication](../guides/auth). Skin mutations are in
[Skins](../guides/skins).

## Statelessness

If you want to remember `target` across runs, serialise the value returned by
`kit.targets.resolve` and pass it back next time — the kit holds no state of its own
between calls. The same applies to authentication: store the refresh token however your
launcher already stores user data; the kit will not write it for you.

See the [library usage guide](../guides/library-usage) for the full facade surface, the
[CLI guide](../guides/cli) for the interactive flow, and the [API reference](../api/)
for generated types.
