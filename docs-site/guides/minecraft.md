# Minecraft

Resolve and inspect Minecraft versions through `kit.versions.minecraft`.

```ts
import { MinecraftChannels } from "@loontail/minecraft-kit";

const releases = await kit.versions.minecraft.list({ channel: MinecraftChannels.RELEASE });
const latest = await kit.versions.minecraft.latest({ channel: MinecraftChannels.RELEASE });
const summary = await kit.versions.minecraft.get({ version: "1.20.1" });
const resolved = await kit.versions.minecraft.resolve({ version: "1.20.1" });
```

`resolve()` returns a `ResolvedMinecraft` containing the **full per-version manifest** (asset
index, libraries, downloads, mainClass, javaVersion).

For a vanilla target, pass `{ type: Loaders.VANILLA }` to `kit.targets.resolve`; no loader
metadata is needed.

```ts
import { Loaders } from "@loontail/minecraft-kit";

const target = await kit.targets.resolve({
  id: "vanilla-1.20.1",
  directory: "./minecrafts/vanilla",
  minecraft: { version: "1.20.1" },
  loader: { type: Loaders.VANILLA },
});
```

## Channels

The library exposes the channels declared by Mojang's `version_manifest_v2.json` —
`release`, `snapshot`, `old_beta`, `old_alpha` — through the `MinecraftChannels` const
map. Use these instead of bare strings.
