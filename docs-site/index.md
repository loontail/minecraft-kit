---
layout: home
hero:
  name: "@loontail/minecraft-kit"
  text: Minecraft launcher kit
  tagline: Stateless TypeScript library and interactive CLI for installing, verifying, repairing, and launching Minecraft — vanilla, Fabric, and modern Forge.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started/
    - theme: alt
      text: API Reference
      link: /api/
features:
  - title: Library + CLI
    details: TypeScript facade plus interactive mckit CLI, backed by the same code.
  - title: Versions API
    details: Symmetric list/resolve for Minecraft, Fabric, Forge, and Mojang Java runtimes.
  - title: Modern Forge
    details: Downloads the installer, runs processors with the installed Mojang JDK, verifies every output hash.
  - title: Microsoft sign-in
    details: Built-in OAuth 2.0 Authorization Code + PKCE over a loopback redirect. Refresh, switch, sign out — no tokens persisted by the kit.
  - title: Skin management
    details: kit.auth.profile.* sets, uploads, or resets the player's skin and returns a fresh MinecraftProfile snapshot every time.
  - title: Typed events
    details: Discriminated-union onEvent covers every download, integrity check, processor, and launch transition.
  - title: Verify and repair
    details: Per-aspect verifiers (minecraft / fabric / forge / runtime) with a repair flow that re-downloads only what's broken.
  - title: Stateless
    details: Writes only the files Minecraft expects — no profile registry, no session files.
---
