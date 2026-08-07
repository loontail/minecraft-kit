import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { configs } from "../tsup.config";

const REPO_ROOT = path.resolve(__dirname, "..");
const SRC = path.join(REPO_ROOT, "src");

const NAMED_CLAUSE = /\b(import|export)\s+(type\s+)?\{([^}]*)\}\s*(?:from\s+"([^"]+)")?/g;
const NAME = /^(type\s+)?([A-Za-z0-9_$]+)(?:\s+as\s+([A-Za-z0-9_$]+))?$/;

type NamedBinding = {
  /** The name as the source module spells it. */
  readonly name: string;
  /** The name this module exposes (or binds locally, for an import). */
  readonly localName: string;
  readonly kind: "import" | "export";
  readonly module: string | null;
  readonly typeOnly: boolean;
};

const parseNamedBindings = (source: string): readonly NamedBinding[] => {
  const found: NamedBinding[] = [];
  for (const match of source.matchAll(NAMED_CLAUSE)) {
    const [, keyword, clauseTypeOnly, clause = "", module] = match;
    for (const raw of clause.split(",")) {
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      const parsed = NAME.exec(trimmed);
      if (parsed === null) continue;
      const name = parsed[2] as string;
      found.push({
        name,
        localName: parsed[3] ?? name,
        kind: keyword as "import" | "export",
        module: module ?? null,
        typeOnly: clauseTypeOnly !== undefined || parsed[1] !== undefined,
      });
    }
  }
  return found;
};

type ReExport = NamedBinding & { readonly module: string };

const parseReExports = (source: string): readonly ReExport[] =>
  parseNamedBindings(source).filter(
    (binding): binding is ReExport => binding.kind === "export" && binding.module !== null,
  );

const sources = new Map<string, string | null>();

const readSource = async (file: string): Promise<string | null> => {
  const cached = sources.get(file);
  if (cached !== undefined) return cached;
  const source = await fs.readFile(file, "utf8").catch(() => null);
  sources.set(file, source);
  return source;
};

/** Resolve a relative specifier the way the bundler does: `./x.ts` first, then `./x/index.ts`. */
const resolveModule = async (
  fromDirectory: string,
  specifier: string,
): Promise<{ readonly file: string; readonly source: string } | null> => {
  const base = path.resolve(fromDirectory, specifier);
  for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
    const source = await readSource(candidate);
    if (source !== null) return { file: candidate, source };
  }
  return null;
};

const DECLARATION_KINDS = "abstract class|class|const|enum|function\\*?|interface|type";
const ERASED_KINDS = new Set(["type", "interface"]);

/** The doc block immediately above the declaration of `name`, or `null` when there is none. */
const docBlockFor = (source: string, name: string): string | null => {
  const declaration = new RegExp(
    `^export (?:declare )?(?:${DECLARATION_KINDS}) ${name}\\b`,
    "m",
  ).exec(source);
  if (declaration?.index === undefined) return null;
  const preceding = source.slice(0, declaration.index).trimEnd();
  if (!preceding.endsWith("*/")) return null;
  const opened = preceding.lastIndexOf("/**");
  return opened === -1 ? null : preceding.slice(opened);
};

/**
 * Follow re-export chains until `name` lands on a declaration, and report whether that
 * declaration survives type erasure. `null` when the chain cannot be resolved statically.
 */
const resolveKind = async (
  fromDirectory: string,
  specifier: string,
  name: string,
  depth = 0,
): Promise<"value" | "type" | null> => {
  if (depth > 8) return null;
  const module = await resolveModule(fromDirectory, specifier);
  if (module === null) return null;
  const declared = new RegExp(`^export (?:declare )?(${DECLARATION_KINDS}) ${name}\\b`, "m").exec(
    module.source,
  );
  if (declared !== null) return ERASED_KINDS.has(declared[1] as string) ? "type" : "value";

  const directory = path.dirname(module.file);
  const bindings = parseNamedBindings(module.source);
  for (const binding of bindings) {
    if (binding.kind !== "export" || binding.localName !== name) continue;
    if (binding.typeOnly) return "type";
    // A bare `export { X };` re-exports an imported binding, so the specifier is on the import.
    const hop =
      binding.module !== null
        ? binding
        : bindings.find(
            (candidate) =>
              candidate.kind === "import" &&
              candidate.localName === binding.name &&
              candidate.module !== null,
          );
    if (hop === undefined || hop.module === null) continue;
    if (hop.typeOnly) return "type";
    const kind = await resolveKind(directory, hop.module, hop.name, depth + 1);
    if (kind !== null) return kind;
  }
  return null;
};

const indexReExports = async (): Promise<readonly ReExport[]> =>
  parseReExports((await readSource(path.join(SRC, "index.ts"))) ?? "");

// KITH-P18: `typedoc.json` sets `excludeInternal`, so an `@internal` symbol that is nevertheless
// re-exported from src/index.ts ships in the .d.ts with no page in the published reference — the
// docs site and the published types then disagree about what is public, in both directions.
describe("published API surface", () => {
  it("re-exports nothing tagged @internal from src/index.ts", async () => {
    const leaked: string[] = [];

    for (const entry of await indexReExports()) {
      const module = await resolveModule(SRC, entry.module);
      const doc = module === null ? null : docBlockFor(module.source, entry.name);
      if (doc?.includes("@internal") === true) {
        leaked.push(`${entry.module} -> ${entry.name}`);
      }
    }

    expect(leaked.sort()).toEqual([]);
  });

  it("resolves the declaration of every re-exported name", async () => {
    const entries = await indexReExports();
    const unresolved: string[] = [];

    for (const entry of entries) {
      const kind = await resolveKind(SRC, entry.module, entry.name);
      if (kind === null) unresolved.push(`${entry.module} -> ${entry.name}`);
    }

    expect(unresolved.sort()).toEqual([]);
    expect(entries.length).toBeGreaterThan(100);
  });

  // A value re-exported as `export type { … }` is erased by esbuild, so the name survives every
  // static check — tsc, attw and a name-only diff of src/index.ts — while the consumer that calls
  // it gets `TypeError: … is not a function`. Type-only-ness has to be asserted, not the name.
  it("re-exports runtime values as values and erased declarations as types", async () => {
    const mismatched: string[] = [];

    for (const entry of await indexReExports()) {
      const kind = await resolveKind(SRC, entry.module, entry.name);
      if (kind === null) continue;
      if (kind === "value" && entry.typeOnly) {
        mismatched.push(`${entry.module} -> ${entry.name} is a value re-exported as type-only`);
      }
      if (kind === "type" && !entry.typeOnly) {
        mismatched.push(`${entry.module} -> ${entry.name} is a type re-exported as a value`);
      }
    }

    expect(mismatched.sort()).toEqual([]);
  });
});

const CODE_REGISTRY = path.join(SRC, "types", "errors.ts");
// An exhaustive `Record<MinecraftKitErrorCode, …>`: TypeScript forces it to name every code, so a
// mention here proves nothing about whether the code is ever thrown.
const CODE_TABLE = path.join(SRC, "cli", "error-format.ts");

const registryCodes = async (): Promise<readonly string[]> => {
  const source = (await readSource(CODE_REGISTRY)) ?? "";
  return [...source.matchAll(/^ {2}([A-Z_]+): "\1",$/gm)].map((match) => match[1] as string);
};

/** Every `| \`CODE\` | trigger | …` row of docs/error-codes.md. */
const documentedCodes = async (): Promise<ReadonlyMap<string, string>> => {
  const source = (await readSource(path.join(REPO_ROOT, "docs", "error-codes.md"))) ?? "";
  const rows = new Map<string, string>();
  for (const match of source.matchAll(/^\|\s*`([A-Z_]+)`\s*\|\s*([^|]*?)\s*\|/gm)) {
    rows.set(match[1] as string, match[2] as string);
  }
  return rows;
};

const sourceFilesMentioning = async (code: string): Promise<readonly string[]> => {
  const entries = await fs.readdir(SRC, { recursive: true, withFileTypes: true });
  const hits: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const file = path.join(entry.parentPath, entry.name);
    if (file === CODE_REGISTRY || file === CODE_TABLE) continue;
    if (((await readSource(file)) ?? "").includes(code)) hits.push(file);
  }
  return hits;
};

describe("error code registry", () => {
  it("documents every registry code and registers every documented code", async () => {
    const registry = await registryCodes();
    const documented = await documentedCodes();

    expect(registry.length).toBeGreaterThan(20);
    expect(registry.filter((code) => !documented.has(code))).toEqual([]);
    expect([...documented.keys()].filter((code) => !registry.includes(code))).toEqual([]);
  });

  // A row that describes a trigger the library never reaches makes a consumer branch on a code it
  // can never receive. A code with no throw site has to say so — `Reserved …` — or go away.
  it("only documents a trigger for codes that are actually thrown", async () => {
    const documented = await documentedCodes();
    const undelivered: string[] = [];

    for (const [code, trigger] of documented) {
      if (trigger.startsWith("Reserved")) continue;
      if ((await sourceFilesMentioning(code)).length === 0) undelivered.push(code);
    }

    expect(undelivered.sort()).toEqual([]);
  });
});

describe("build layout", () => {
  // why: tsup runs the array's configs through `Promise.all`, so a per-config `clean` races the
  // sibling that writes `dist/cli/index.mjs` — and npm silently omits a missing `files` entry, so
  // a publish would succeed with the `mckit` bin pointing at nothing. The wipe has to happen once
  // in the config factory, before either build starts.
  it("wipes dist from the config factory, never from inside a concurrent config", async () => {
    const factory = (await import("../tsup.config")).default;

    expect(typeof factory).toBe("function");
    expect(configs.length).toBeGreaterThan(1);
    expect(
      configs.filter((config) => config.clean !== false).map((config) => config.entry),
    ).toEqual([]);
  });
});
