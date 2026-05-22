# Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          MinecraftKit                                    │
│                                                                          │
│  versions: { minecraft, fabric, forge, runtime }                         │
│  targets:  { create, resolve, list }                                     │
│  install:  { plan, run, runtime: { plan, run, standalonePlan } }         │
│  update:   { plan, run }                                                 │
│  verify:   { minecraft, fabric, forge, runtime }                         │
│  repair:   { minecraft, fabric, forge, runtime, all }                    │
│  launch:   { compose, run }                                              │
│  auth:     { refresh, authorizationCode: { run } }                       │
└──────────────────────────────────────────────────────────────────────────┘
        │                              │
        ▼                              ▼
   HttpClient                      Spawner
   ──────────                      ──────────
   FetchHttpClient                 ChildProcessSpawner
   (node fetch)                    (node:child_process)
        │
        ▼
   MetadataCache (LRU, in-memory, 5-minute default TTL)
```

## Layered modules

```
src/types/         Public type definitions and `as const` discriminator maps.
src/constants/     URLs, defaults, limits, file-segment names.
src/core/          Pure helpers — errors, hashing, fs, archive, retries, rules,
                   manifest merging, throttling, UUID, abort/checkpoint,
                   assert-never, JSON parse + shape guards, scoped logger.
src/http/          Transport — HttpClient, in-memory cache, streaming downloader
                   (with URL scheme + optional host allow-list).
src/versions/      Version resolvers (Mojang / Fabric / Forge / runtime).
src/targets/       Target factory + filesystem scanner.
src/install/       Install planner + runner (split into stage functions) +
                   Forge processor execution.
src/update/        Thin wrapper over install (skip-already-correct).
src/verify/        On-disk verification per aspect.
src/repair/        Aspect repair = install plan ∩ verification issues.
src/launch/        Argument composition + child-process lifecycle.
src/auth/          Microsoft OAuth → Xbox → Minecraft sign-in pipeline.
src/cli/           Interactive `mckit`; imports only the public facade.
src/kit.ts         `MinecraftKit` facade.
src/index.ts       Public barrel.
```

See [stateless](./stateless), [library usage](./library-usage), and [install](./install)
for the on-disk layout, DI contract, and plan/run model respectively.
