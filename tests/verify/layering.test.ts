import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const VERIFY_DIR = path.join(process.cwd(), "src", "verify");

const IMPORT_SOURCE = /from\s+"([^"]+)"/g;

// KIT-P12: `verify/target-readiness.ts` used to pull `ASPECTS` out of `repair/aspects.ts`, which
// imports all four verifiers back — a real cycle that also dragged `install/planner` into the
// import graph of a readiness check that is otherwise network-free. The registry is now split:
// `verify/aspects.ts` owns the verifier map, `repair/aspects.ts` composes the plan half over it.
describe("src/verify layering", () => {
  it("never imports from src/repair or src/install/planner", async () => {
    const files = (await fs.readdir(VERIFY_DIR)).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await fs.readFile(path.join(VERIFY_DIR, file), "utf8");
      for (const match of source.matchAll(IMPORT_SOURCE)) {
        const specifier = match[1] ?? "";
        if (specifier.startsWith("../repair/") || specifier === "../install/planner") {
          offenders.push(`${file} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
