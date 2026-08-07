import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

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
        lines: 90,
        branches: 80,
        functions: 84,
        statements: 90,
      },
      clean: true,
    },
  },
});
