# Getting started

`@loontail/minecraft-kit` is a TypeScript library and an interactive `mckit` CLI for
installing, verifying, repairing, and launching vanilla Minecraft, Fabric, and modern
Forge. Both share the same code — anything the CLI does, your launcher can do too.

Requirements: Node ≥ 20.11. ESM-only.

- [Installation →](./installation) — install the package and CLI.
- [Quickstart →](./quickstart) — offline launch in 4 calls; online launch with Microsoft
  sign-in.

After the quickstart, the guides walk through each surface in depth:

- [Library usage](../guides/library-usage) — the full facade and DI options.
- [Authentication](../guides/auth) — Microsoft OAuth + PKCE, refresh, plug into launch.
- [Skins](../guides/skins) — `kit.auth.profile.*` mutations.
- [Install](../guides/install) · [Verify & repair](../guides/verify-repair) ·
  [Launch](../guides/launch) — the install/verify/repair/launch lifecycle.
