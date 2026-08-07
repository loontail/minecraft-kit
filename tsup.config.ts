import { defineConfig, type Options } from "tsup";
import pkg from "./package.json";

const shared: Omit<Options, "entry" | "format" | "clean" | "banner"> = {
  target: "node22",
  platform: "node",
  dts: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  shims: false,
  tsconfig: "./tsconfig.build.json",
  noExternal: ["p-limit", "yocto-queue"],
  outExtension: ({ format }) => ({ js: format === "esm" ? ".mjs" : ".cjs" }),
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
};

export default defineConfig([
  {
    ...shared,
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    clean: true,
  },
  {
    ...shared,
    entry: { "cli/index": "src/cli/index.ts" },
    format: ["esm"],
    clean: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
