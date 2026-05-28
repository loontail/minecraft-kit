# Library usage

Use the facade for normal launcher code:

```ts
import { MinecraftKit } from "@loontail/minecraft-kit";

const kit = new MinecraftKit();
```

## Facade surface

| Namespace | Methods |
|---|---|
| `kit.versions.{minecraft,fabric,forge,runtime}` | `list`, `resolve` (and `latest` / `get` on `minecraft`) |
| `kit.targets` | `create`, `resolve`, `list` |
| `kit.install` | `plan`, `run`, `runtime.{plan,run,standalonePlan}` |
| `kit.verify.{minecraft,fabric,forge,runtime}` | `run` |
| `kit.repair.{minecraft,fabric,forge,runtime}` | `plan`, `run` (plus `kit.repair.all`) |
| `kit.launch` | `compose`, `run` |
| `kit.auth` | `authorizationCode.run`, `refresh` |
| `kit.auth.profile` | `setSkinFromUrl`, `uploadSkin`, `resetSkin` |
| `kit.cache` | `get`, `set`, `delete`, `clear` |

## Constructor options

```ts
new MinecraftKit({
  httpClient,  // optional — defaults to FetchHttpClient (node fetch)
  cache,       // optional — defaults to createMemoryCache() (LRU, 5-min TTL)
  logger,      // optional — defaults to silentLogger
  system,      // optional — defaults to detectSystem()
  spawner,     // optional — defaults to ChildProcessSpawner
});
```

Replace dependencies for tests, custom transport, logging, or process supervision.

## Symmetric versions API

```ts
import { MinecraftChannels, VersionPreference, RuntimePreference } from "@loontail/minecraft-kit";

await kit.versions.minecraft.list({ channel: MinecraftChannels.RELEASE });
await kit.versions.minecraft.resolve({ version: "1.20.1" });

await kit.versions.fabric.list({ minecraftVersion: "1.20.1" });
await kit.versions.fabric.resolve({
  minecraftVersion: "1.20.1",
  preference: VersionPreference.LATEST,
});

await kit.versions.forge.list({ minecraftVersion: "1.20.1" });
await kit.versions.forge.resolve({
  minecraftVersion: "1.20.1",
  preference: VersionPreference.RECOMMENDED,
});

await kit.versions.runtime.list({ system: kit.targets.system });
await kit.versions.runtime.resolve({
  system: kit.targets.system,
  component: "java-runtime-gamma",
  preference: RuntimePreference.RECOMMENDED,
});
```

## Standalone helpers

Import standalone helpers when you do not want the facade:

```ts
import {
  verifyMinecraft,
  planMinecraftRepair,
  runRepair,
  planRuntimeInstall,
  MojangAuthApi,
  toOnlineAuth,
  FetchHttpClient,
  createMemoryCache,
} from "@loontail/minecraft-kit";
```

The facade composes these with the injected dependencies.

## Logging

Pass a `Logger` to the constructor for trace output. The kit ships three implementations:

```ts
import { consoleLogger, silentLogger, scopedLogger } from "@loontail/minecraft-kit";

const kit = new MinecraftKit({ logger: scopedLogger(consoleLogger, "launcher") });
```

`scopedLogger(base, scope, baseFields?)` prefixes messages with `[scope]` and merges
`baseFields` into every emission. The auth flow logs through `scopedLogger(base, "auth")`.

## Serialising a target

`kit.targets.resolve` returns a self-contained `Target`. To reuse it later, persist the
same `id` / `directory` / `minecraft` / `loader` inputs and resolve again. Upstream
metadata is fetched again; the kit stores no launcher state.
