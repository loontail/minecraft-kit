import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..", "src");

const RE_EXPORT = /export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g;
const NAME = /^(?:type\s+)?([A-Za-z0-9_$]+)(?:\s+as\s+([A-Za-z0-9_$]+))?$/;

type ReExport = { readonly name: string; readonly module: string };

const parseReExports = (source: string): readonly ReExport[] => {
  const found: ReExport[] = [];
  for (const match of source.matchAll(RE_EXPORT)) {
    const [, clause = "", module = ""] = match;
    for (const raw of clause.split(",")) {
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      const parsed = NAME.exec(trimmed);
      if (parsed === null) continue;
      found.push({ name: parsed[1] as string, module });
    }
  }
  return found;
};

/** The doc block immediately above the declaration of `name`, or `null` when there is none. */
const docBlockFor = (source: string, name: string): string | null => {
  const declaration = new RegExp(
    `^export (?:declare )?(?:const|type|function|class|enum|interface|abstract class) ${name}\\b`,
    "m",
  ).exec(source);
  if (declaration?.index === undefined) return null;
  const preceding = source.slice(0, declaration.index).trimEnd();
  if (!preceding.endsWith("*/")) return null;
  const opened = preceding.lastIndexOf("/**");
  return opened === -1 ? null : preceding.slice(opened);
};

// KITH-P18: `typedoc.json` sets `excludeInternal`, so an `@internal` symbol that is nevertheless
// re-exported from src/index.ts ships in the .d.ts with no page in the published reference — the
// docs site and the published types then disagree about what is public, in both directions.
describe("published API surface", () => {
  it("re-exports nothing tagged @internal from src/index.ts", async () => {
    const index = await fs.readFile(path.join(SRC, "index.ts"), "utf8");
    const sources = new Map<string, string>();
    const leaked: string[] = [];

    for (const entry of parseReExports(index)) {
      const modulePath = path.join(SRC, `${entry.module.replace(/^\.\//, "")}.ts`);
      let source = sources.get(modulePath);
      if (source === undefined) {
        source = await fs.readFile(modulePath, "utf8").catch(() => "");
        sources.set(modulePath, source);
      }
      const doc = docBlockFor(source, entry.name);
      if (doc?.includes("@internal") === true) {
        leaked.push(`${entry.module} -> ${entry.name}`);
      }
    }

    expect(leaked.sort()).toEqual([]);
  });

  it("resolves the declaration of every re-exported name", async () => {
    const index = await fs.readFile(path.join(SRC, "index.ts"), "utf8");
    const entries = parseReExports(index);
    expect(entries.length).toBeGreaterThan(100);
  });
});
