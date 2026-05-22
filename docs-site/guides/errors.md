# Errors

Every error thrown by a public API is a `MinecraftKitError` carrying a stable `code`,
a frozen `context`, and (optionally) the wrapped `cause`. Narrow with the type guards:

```ts
import {
  isErrorCode,
  isMinecraftKitError,
  MinecraftKitErrorCodes,
} from "@loontail/minecraft-kit";

try {
  await kit.install.run(plan);
} catch (error) {
  if (isErrorCode(error, MinecraftKitErrorCodes.INTEGRITY_HASH_MISMATCH)) {
    console.warn("file corrupted:", error.context.url);
    // error.context.expectedHash / .actualHash also available
  } else if (isMinecraftKitError(error)) {
    console.error(error.code, error.message);
    throw error;
  } else {
    throw error;
  }
}
```

`isErrorCode(error, code)` accepts either the literal string or the `MinecraftKitErrorCodes`
constant — the union derives from the as-const map, so both are type-equivalent. Prefer the
constant: a typo on the literal is a no-match silently; a typo on the constant is a compile
error.

## Codes by family

### Network

`NETWORK_TIMEOUT`, `NETWORK_HTTP_ERROR`, `NETWORK_ABORTED`.

### Filesystem

`FILESYSTEM_WRITE_ERROR`, `FILESYSTEM_READ_ERROR`, `FILESYSTEM_PATH_TRAVERSAL` (zip-slip
defence triggered).

### Integrity

`INTEGRITY_HASH_MISMATCH`, `INTEGRITY_SIZE_MISMATCH` — fired by `downloadFile` after a
streaming hash/size check.

### Archives

`ARCHIVE_INVALID`, `ARCHIVE_TOO_LARGE` (zip-bomb cap), `ARCHIVE_ENTRY_REJECTED` (e.g. null
bytes, reserved Windows names, absolute paths inside the zip).

### Manifests

`MANIFEST_NOT_FOUND`, `MANIFEST_INVALID` (shape check failed — see `src/core/guards.ts`),
`METADATA_PARSE_ERROR`.

### Runtime / Forge / Launch

`RUNTIME_NOT_FOUND`, `RUNTIME_UNSUPPORTED_PLATFORM`, `FORGE_INSTALLER_INVALID`,
`FORGE_PROCESSOR_FAILED`, `LAUNCH_JAVA_NOT_FOUND`, `LAUNCH_PROCESS_FAILED`, `LAUNCH_ABORTED`.

### Authentication

The OAuth flow has its own code surface so you can branch on the exact failure:

| Code | Meaning |
|---|---|
| `AUTH_MISSING_CLIENT_ID` | No `clientId` passed and `MINECRAFT_KIT_MSA_CLIENT_ID` is unset. |
| `AUTH_AUTHORIZATION_CODE_FAILED` | Microsoft's `/token` endpoint rejected the authorization code exchange (PKCE mismatch, redirect_uri mismatch, public-flow misconfig, …). |
| `AUTH_AUTHORIZATION_CODE_DECLINED` | The user closed the browser without signing in, or Microsoft returned `access_denied` on the loopback redirect. |
| `AUTH_REFRESH_FAILED` | Microsoft refused a refresh-token exchange. |
| `AUTH_XBOX_FAILED` | Xbox Live RPS exchange failed or returned incomplete data. |
| `AUTH_XSTS_FAILED` | XSTS returned 401 + `XErr`. The `context.xerr` numeric tells you whether the account has no Xbox profile, is a child account, is region-restricted, etc. |
| `AUTH_MINECRAFT_FAILED` | Mojang `login_with_xbox` / `minecraft/profile` failed, including the 403 + "invalid app registration" case that needs `https://aka.ms/mce-reviewappid`. |
| `AUTH_NO_GAME_OWNERSHIP` | This Microsoft account does not own Java Edition. |
| `AUTH_CANCELLED` | Caller's `AbortSignal` aborted the loopback wait or the post-token pipeline. |

### Misc

`INVALID_INPUT`, `VERIFICATION_FAILED`, `NOT_IMPLEMENTED`, `UNSUPPORTED_VERSION`.

## Conventions

- Codes are stable across releases. Adding new codes is non-breaking; removing or renaming a
  code is a breaking change.
- Context fields are additive — adding a new field is non-breaking, removing one is breaking.
- `error.toJSON()` returns a serialisable representation without the prototype chain, safe
  to log to disk or ship over IPC.
