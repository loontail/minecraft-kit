import { defineConfig } from "vitest/config";
import pkg from "./package.json";

export default defineConfig({
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
  test: {
    globals: false,
    environment: "node",
    pool: "forks",
    isolate: true,
    fileParallelism: true,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/types/**",
        "src/index.ts",
        "src/cli/index.ts",
        "src/cli/main.ts",
      ],
      thresholds: {
        lines: 73,
        branches: 71,
        functions: 73,
        statements: 73,
      },
      all: true,
      clean: true,
    },
  },
});
