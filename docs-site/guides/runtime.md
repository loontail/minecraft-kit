# Runtime

`kit.versions.runtime` reads the canonical Mojang index at
`piston-meta.mojang.com/v1/products/java-runtime/.../all.json`.

```ts
import { RuntimePreference, detectSystem } from "@loontail/minecraft-kit";

const system = detectSystem();
const list = await kit.versions.runtime.list({ system });

const runtime = await kit.versions.runtime.resolve({
  system,
  component: "java-runtime-gamma",
  preference: RuntimePreference.RECOMMENDED,
});
```

## Component selection

The Minecraft per-version manifest declares the required component (e.g.
`java-runtime-gamma`, `java-runtime-delta`, `jre-legacy`). `kit.targets.resolve` picks that
component automatically. Override `component` only to force a different JDK than the manifest
declares.

## Install layout

Runtime files land under `<directory>/runtime/<component>/...`. The Java executable lives at:

| OS       | Path                                                  |
|----------|-------------------------------------------------------|
| Windows  | `runtime/<component>/bin/javaw.exe`                   |
| macOS    | `runtime/<component>/jre.bundle/Contents/Home/bin/java` |
| Linux    | `runtime/<component>/bin/java`                        |

Symlinks declared in the per-component manifest are materialized natively on macOS/Linux and
fall back to byte copies on Windows where unprivileged users cannot create symlinks. The kit
downloads each runtime file from its raw URL; the optional LZMA1 sidecar advertised by Mojang
is ignored.
