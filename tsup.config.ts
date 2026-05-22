import { type Options, defineConfig } from "tsup";

const shared: Omit<Options, "entry" | "format" | "clean" | "banner"> = {
  target: "node20",
  platform: "node",
  dts: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  shims: false,
  tsconfig: "./tsconfig.build.json",
  noExternal: ["p-limit", "yocto-queue"],
  outExtension: ({ format }) => ({ js: format === "esm" ? ".mjs" : ".cjs" }),
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
