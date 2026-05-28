# Security model

The kit treats HTTP metadata, archive contents, filesystem paths, and spawned processes as
untrusted boundaries.

## Downloads

### URL scheme allow-list

`downloadFile` rejects any URL that isn't parseable or whose scheme is not `https:` or
`http:`. Closes the manifest-injection class — a malicious Mojang/Forge manifest cannot
coax `fetch` into following `file://`, `data:`, or `javascript:` URLs.

```ts
// throws MinecraftKitError("INVALID_INPUT") before any network call
await downloadFile(http, { url: "file:///etc/passwd", target });
```

### Host allow-list (optional)

`downloadFile` accepts a `hostAllowList` that pins downloads to exact hosts or leading
wildcard labels:

```ts
import { FetchHttpClient } from "@loontail/minecraft-kit";

const hostAllowList = [
  "*.minecraft.net",
  "*.minecraftservices.com",
  "*.mojang.com",
  "maven.minecraftforge.net",
  "libraries.minecraft.net",
];
```

When set, anything outside the list throws `INVALID_INPUT` before fetch, with
`error.context.host` carrying the rejected hostname. The list is not yet plumbed through
the high-level `kit.install.run` options; if you need host pinning today, wrap your
`HttpClient` to reject non-allowlisted hosts and pass it via `new MinecraftKit({ httpClient })`.

## Manifests

Network JSON passes through lightweight runtime predicates in `src/core/guards.ts` before
the code trusts it. Currently enforced:

- `MinecraftVersionManifest` shape on `kit.versions.minecraft.resolve()` — id, mainClass,
  assetIndex (id + sha1 + size + url), and downloads.client (sha1 + size + url) are all
  required and type-checked.
- `INTEGRITY_HASH_MISMATCH` / `INTEGRITY_SIZE_MISMATCH` at the download boundary — the
  downloader computes sha1 on the fly and rejects bytes that don't match the manifest.

Predicates are permissive on field *values* because legacy Mojang manifests can ship
placeholder hashes. Integrity is enforced at download time.

Add new guards to `src/core/guards.ts` and call `parseJsonAs(text, guard, { code, message })`
at the boundary.

## Archives

Zip/jar handling in `src/core/archive.ts` defends against:

| Attack | Defence |
|---|---|
| Zip slip (`../etc/passwd`) | `assertWithinRoot` rejects extracted paths that resolve outside the target directory. |
| Absolute paths inside the zip | `assertSafeEntryName` rejects `/etc/passwd`, `C:\...`, and Windows drive letters. |
| Null-byte injection | Entry names containing `\0` are rejected. |
| Reserved Windows names (`CON`, `NUL`, …) | Rejected. |
| Trailing dot / whitespace | Rejected (Windows would silently strip and re-target). |
| Zip bomb (entries) | `EXTRACTION_MAX_ENTRIES` cap. |
| Zip bomb (per-entry size) | `EXTRACTION_MAX_ENTRY_SIZE` cap. |
| Zip bomb (total uncompressed size) | `EXTRACTION_MAX_TOTAL_SIZE` cap. |
| Zip bomb (compression ratio) | `EXTRACTION_MAX_COMPRESSION_RATIO` cap. |

All four caps live in `src/constants/limits.ts`.

## Filesystem writes

`atomicWrite(path, content)` writes to a sibling temp file then renames over the
destination. A crash mid-write leaves either the old file or the new one, never a partial
write. The same atomic pattern is used by `downloadFile`'s temp `<target>.<random>.download`
that gets `fs.rename`d only after hash + size checks pass.

## Child processes

`runProcessor` (Forge installer steps) and `runLaunch` (Minecraft itself) both go through
the injected `Spawner`. The default `ChildProcessSpawner`:

- Never sets `shell: true`. Arguments are passed as an array so the OS shell never expands
  them.
- Passes the resolved Java path absolute (computed via `targetPaths.runtimeJavaExecutable`)
  — the user's `PATH` cannot redirect the launch.
- Caps line buffers at `SPAWNER_MAX_LINE_BYTES` so a malicious processor cannot OOM the
  launcher with one giant line.
- The Forge processor lifecycle (`runProcessor`) verifies every declared output sha1
  before continuing — a processor cannot smuggle replacement artifacts into the install.

## Authentication

Tokens never touch disk. `kit.auth.authorizationCode.run()` returns a session; storing
the refresh token is the caller's job. The kit ships zero default credentials —
`MINECRAFT_KIT_MSA_CLIENT_ID` must be set or the caller passes `clientId` explicitly.
Auth trace can leak token lengths (not contents); it stays silent unless a `Logger` is
wired or `MINECRAFT_KIT_AUTH_DEBUG=1` is set.

## What the kit does NOT defend against

- **Compromised upstream manifests with valid signatures.** If Mojang signs a manifest
  that points at a sha1 the attacker controls, the integrity check passes. The kit cannot
  do anything about an upstream supply-chain compromise — your only defence is the host
  allow-list to keep an attacker from re-pointing downloads at an off-prem host.
- **Malicious mod jars run by the Forge processors.** Forge processors are arbitrary Java
  code that Mojang/Forge tell us to run. We sandbox the *output* (sha1 checks the produced
  files), but the processor itself runs with whatever permissions the launcher has.
- **The Minecraft process itself.** Once `runLaunch` spawns the child, it is in user-space
  alongside the launcher. Sandbox the child via OS facilities if you need stronger
  isolation.
