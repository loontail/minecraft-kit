---
layout: home
hero:
  name: "@loontail/minecraft-kit"
  text: Minecraft launcher kit
  tagline: Stateless TypeScript library and CLI for Minecraft install, verify, repair, launch, auth, and skins.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started/
    - theme: alt
      text: API Reference
      link: /api/
features:
  - title: Library + CLI
    details: One TypeScript facade and the same flows in mckit.
  - title: Versions API
    details: List and resolve Minecraft, Fabric, Forge, and Mojang runtimes.
  - title: Modern Forge
    details: Downloads the installer, runs processors with the installed Mojang JDK, verifies every output hash.
  - title: Microsoft sign-in
    details: OAuth 2.0 Authorization Code + PKCE over loopback; token storage stays in the host.
  - title: Skin management
    details: Set, upload, or reset skins through kit.auth.profile.*.
  - title: Typed events
    details: Discriminated-union onEvent payloads for long-running operations.
  - title: Verify and repair
    details: Per-aspect verifiers (minecraft / fabric / forge / runtime) with a repair flow that re-downloads only what's broken.
  - title: Stateless
    details: Writes only the files Minecraft expects — no profile registry, no session files.
---
