# Installation

```bash
npm install @loontail/minecraft-kit
```

ESM-only. Node ≥ 22.12.

The `mckit` binary is available after install:

```bash
npx mckit
```

## Requirements

- Node ≥ 22.12.
- Network access to `piston-meta.mojang.com`, `meta.fabricmc.net`,
  `maven.minecraftforge.net`, `files.minecraftforge.net`.
- ~1.5 GB per vanilla install (client jar + assets); ~150 MB per Java runtime.

Java is not required on the host unless you install/repair Forge or launch Minecraft — the
kit downloads and uses the Mojang JDK for both.
