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

1. **Make sure the installer JAR is at** `forge-installers/<full>-installer.jar`. Forge publishes
   no hash or size for its installers, so the usual skip-on-correct cannot apply; instead the copy
   already on disk is reused whenever `install_profile.json` still parses out of it, and is
   deleted and re-downloaded when it does not. Corruption further into the archive is caught too:
   any archive failure while planning reads the JAR re-fetches it once. The installer is a planning
   input, not a launch artifact — it is deliberately **not** a `DOWNLOAD_FILE` action in the plan,
   so `install.run` never fetches it a second time. The flip side: a Forge plan is only replayable
   while that installer is still on disk, because `{INSTALLER}` is baked into processor arguments.
2. **Open the JAR** and read `install_profile.json`.
3. **Branch by installer shape.**
   - Modern profiles read the referenced `version.json`, extract embedded `maven/` entries
     into `libraries/<group>/<artifact>/<version>/`, resolve data tokens, and plan processor
     invocations. The `maven/` flush is guarded by a `libraries/.forge-<full>.extracted`
     sentinel holding the installer's size + mtime plus every path the flush wrote, so re-planning
     the same target does not rewrite the whole embedded tree — but a recorded artifact that has
     since disappeared (antivirus, disk cleaner, manual delete) does re-extract, which is the only
     way to restore one: embedded artifacts carry `url: ""` and no download can replace them.
     `verify.forge` existence-checks the same recorded paths. The sentinel lives inside
     `libraries/` on purpose: deleting that directory by hand invalidates it.
   - Legacy profiles read `versionInfo`, extract the embedded universal JAR referenced by
     `install.filePath` into its Maven library path, and skip processors.
4. **Plan downloads** for every declared library that is not already supplied by the
   installer archive.
5. **Run downloads** in parallel; install the runtime; **run processors sequentially** when
   the profile declares them; verify every declared `output` SHA-1.
6. **Write `versions/<forge-id>/<forge-id>.json`** so the launch composer can find the
   merged manifest.

The processor outputs are generated locally, so no URL can restore one. `verify.forge` therefore
re-reads the declared `output` SHA-1s off the installer JAR on disk and hash-checks them under the
`forge-processor-output` category, and `repair.forge` re-runs exactly the processors whose outputs
are broken. That is what makes a cancelled or crashed Forge install repairable instead of a
verified-valid tree that dies inside Forge's bootstrap — keeping the installer JAR around is what
buys it.

## Built-in processor tokens

| Token              | Resolved value                                           |
|--------------------|----------------------------------------------------------|
| `{SIDE}`           | `"client"`                                               |
| `{MINECRAFT_JAR}`  | `<directory>/versions/<mc>/<mc>.jar`                     |
| `{MINECRAFT_VERSION}` | `<mc>`                                               |
| `{ROOT}`           | `<directory>` (the per-target root)                       |
| `{INSTALLER}`      | Absolute path to the installer JAR on disk                 |
| `{LIBRARY_DIR}`    | `<directory>/libraries`                                   |

`[g:a:v[:c][@e]]` references are resolved to absolute paths under `LIBRARY_DIR`.
