import { rm } from "node:fs/promises";
import { defineConfig, type Options } from "tsup";
import pkg from "./package.json";

const OUT_DIR = "dist";

const shared: Omit<Options, "entry" | "format" | "clean" | "banner"> = {
  target: "node22",
  platform: "node",
  dts: true,
  // why: shipping them is 1.54 MB in every install (the package trebles) for a
  // debug aid nothing enables — the sole consumer runs this in Electron's main
  // process without --enable-source-maps. Not emitting them is also what removes
  // the dangling sourceMappingURL, which is the reason they were briefly shipped.
  sourcemap: false,
  splitting: false,
  treeshake: true,
  shims: false,
  tsconfig: "./tsconfig.build.json",
  noExternal: ["p-limit", "yocto-queue"],
  outExtension: ({ format }) => ({ js: format === "esm" ? ".mjs" : ".cjs" }),
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
};

export const configs: readonly Options[] = [
  {
    ...shared,
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    clean: false,
  },
  {
    ...shared,
    entry: { "cli/index": "src/cli/index.ts" },
    format: ["esm"],
    clean: false,
    banner: { js: "#!/usr/bin/env node" },
    // The `mckit` bin is not an import target: no export subpath, no consumer types.
    dts: false,
  },
];

// why: tsup runs the array's configs through `Promise.all`, so a per-config `clean` races the
// sibling writing `dist/cli/index.mjs` — and npm silently omits a missing `files` entry, so the
// publish would still succeed with the `mckit` bin pointing at nothing. Wipe once, up front.
export default defineConfig(async () => {
  await rm(OUT_DIR, { recursive: true, force: true });
  return [...configs];
});
