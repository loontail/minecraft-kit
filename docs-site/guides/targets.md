# Targets

A `Target` is the pinned, fully-resolved combination of:

- a Minecraft version (with parsed manifest),
- a loader (vanilla / Fabric / Forge),
- a Mojang Java runtime,
- a directory.

The Target is the unit that every other API consumes. Build one with `kit.targets.create`
(from already-resolved components) or `kit.targets.resolve` (sugar that resolves everything
in one call).

## Resolve

```ts
import {
  asMinecraftVersionId,
  Loaders,
  RuntimePreference,
  VersionPreference,
} from "@loontail/minecraft-kit";

const target = await kit.targets.resolve({
  id: "fabric-client",
  directory: "./minecrafts/fabric-client",
  minecraft: { version: asMinecraftVersionId("1.20.1") },
  loader: { type: Loaders.FABRIC, preference: VersionPreference.LATEST },
  runtime: { preference: RuntimePreference.RECOMMENDED },
});
```

`latest` / `recommended` / `auto` are inputs to the resolver. Once the call returns, the
target carries concrete versions only — there is no “latest” inside a resolved target.

## Create from resolved components

```ts
const target = kit.targets.create({
  id,
  directory,
  minecraft,   // ResolvedMinecraft
  loader,      // Loader
  runtime,     // ResolvedRuntime
});
```

This shape is preferred when you already resolved the components separately (e.g. to show a
preview to the user).

## List

```ts
const installed = await kit.targets.list({ rootDir: "./minecrafts" });
```

`list()` answers exactly one question: **what is on disk?** It scans `rootDir` for sub-folders
that look like Minecraft installations (presence of `versions/` plus `libraries/` or
`assets/`) and returns the version IDs and loader hints it found. It does **not** check for
correctness, completeness, or repair state — for that, use `kit.verify.run`.
