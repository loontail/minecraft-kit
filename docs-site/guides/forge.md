# Forge

`kit.versions.forge` reads `maven.minecraftforge.net/.../maven-metadata.xml` and the
`promotions_slim.json` mapping. The installer planner supports both modern processor-based
Forge installers and legacy installers that ship an embedded universal JAR.

```ts
import { Loaders, VersionPreference } from "@loontail/minecraft-kit";

const builds = await kit.versions.forge.list({ minecraftVersion: "1.7.10" });
const resolved = await kit.versions.forge.resolve({
  minecraftVersion: "1.7.10",
  preference: VersionPreference.RECOMMENDED,
});
```

## Install flow

The Forge install is the most involved flow in the library:

1. **Download the installer JAR** to `forge-installers/<full>-installer.jar`.
2. **Open the JAR** and read `install_profile.json`.
3. **Branch by installer shape.**
   - Modern profiles read the referenced `version.json`, extract embedded `maven/` entries
     into `libraries/<group>/<artifact>/<version>/`, resolve data tokens, and plan processor
     invocations.
   - Legacy profiles read `versionInfo`, extract the embedded universal JAR referenced by
     `install.filePath` into its Maven library path, and skip processors.
4. **Plan downloads** for every declared library that is not already supplied by the
   installer archive.
5. **Run downloads** in parallel; install the runtime; **run processors sequentially** when
   the profile declares them; verify every declared `output` SHA-1.
6. **Write `versions/<forge-id>/<forge-id>.json`** so the launch composer can find the
   merged manifest.

## Built-in processor tokens

| Token              | Resolved value                                           |
|--------------------|----------------------------------------------------------|
| `{SIDE}`           | `"client"`                                               |
| `{MINECRAFT_JAR}`  | `<directory>/versions/<mc>/<mc>.jar`                     |
| `{MINECRAFT_VERSION}` | `<mc>`                                               |
| `{ROOT}`           | `<directory>` (the per-target root)                       |
| `{INSTALLER}`      | Absolute path to the downloaded installer JAR             |
| `{LIBRARY_DIR}`    | `<directory>/libraries`                                   |

`[g:a:v[:c][@e]]` references are resolved to absolute paths under `LIBRARY_DIR`.
