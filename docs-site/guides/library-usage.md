# Library usage

Every public capability hangs off a single facade class:

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

Every dependency is replaceable.

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

Every method on `MinecraftKit` has a standalone counterpart you can import directly if
you do not want the facade:

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

The facade just composes these with the injected dependencies for you.

## Logging

Pass a `Logger` to the constructor for trace output. The kit ships three implementations:

```ts
import { consoleLogger, silentLogger, scopedLogger } from "@loontail/minecraft-kit";

const kit = new MinecraftKit({ logger: scopedLogger(consoleLogger, "launcher") });
```

`scopedLogger(base, scope, baseFields?)` returns a `Logger` that prefixes every line
with `[scope]` and merges `baseFields` into every emission. Returns the silent logger
short-circuit when the base is silent. Internal modules of the kit already use this —
the auth flow logs through `scopedLogger(base, "auth")`, for example.

## Serialising a target

`kit.targets.resolve` returns a fully self-contained `Target`. To remember it across
processes, JSON-stringify the result; to use it later, pass the same `id` / `directory`
/ `minecraft` / `loader` inputs to `kit.targets.resolve` again — the only thing fetched
again is upstream metadata. There is no other persisted state.
