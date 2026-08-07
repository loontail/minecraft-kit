/**
 * Fail when the package's public surface loses something a consumer pinned on a caret range needs
 * to be shielded from: an exported name from `src/index.ts`, the runtime half of a name that used
 * to be a value, or an `exports` subpath.
 *
 * The release workflow already derives the bump level from the conventional commits since the
 * last `v*` tag. That derivation only sees commit *subjects*: a `fix:` or `refactor:` that
 * happens to delete an exported symbol releases as a patch, and every consumer on
 * `^currentVersion` is handed a compile break on `npm update`. This is the second net — it
 * compares the actual public surface against the last release and insists the derived level
 * covers a removal.
 *
 * While the package is 0.x a minor is enough (`^0.9.0` does not accept `0.10.0`); from 1.0.0 on
 * only a major is.
 *
 * Usage: `node scripts/check-exported-names.mjs [--base <tag>]`
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = "src/index.ts";
const MANIFEST = "package.json";

const git = (args) =>
  execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/**
 * Every name `source` exports, following `as` aliases to the externally visible name, split by
 * whether the export survives type erasure.
 */
const exportedNames = (source, label) => {
  const file = ts.createSourceFile(ENTRY, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const values = new Set();
  const types = new Set();
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause === undefined) {
        // `export * from "…"` hides the name set from a static reader, which would let a removal
        // through unseen. Refuse rather than under-report.
        throw new Error(`${label}: ${ENTRY} uses \`export *\`, which this check cannot resolve`);
      }
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const erased = statement.isTypeOnly || element.isTypeOnly;
          (erased ? types : values).add(element.name.text);
        }
      } else {
        (statement.isTypeOnly ? types : values).add(statement.exportClause.name.text);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      throw new Error(`${label}: ${ENTRY} uses \`export =\`/\`export default\``);
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) !== true) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) values.add(declaration.name.text);
      }
      continue;
    }
    if (statement.name !== undefined && ts.isIdentifier(statement.name)) {
      const erased = ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement);
      (erased ? types : values).add(statement.name.text);
    }
  }
  return { values, types };
};

/** Every subpath `package.json#exports` lets a consumer import. */
const exportSubpaths = (source) => {
  const map = JSON.parse(source).exports;
  if (map === undefined || typeof map === "string") return new Set(["."]);
  const subpaths = Object.keys(map).filter((key) => key.startsWith("."));
  // A conditions-only map (`{"import": …, "require": …}`) exposes the root and nothing else.
  return new Set(subpaths.length === 0 ? ["."] : subpaths);
};

/** The same level derivation the release workflow performs, over the same commit range. */
const derivedLevel = (range, currentMajor) => {
  const log = git(["log", "--format=%s%n%b%n--", range]);
  if (/^[a-z]+(\([^)]*\))?!:|^BREAKING[ -]CHANGE/m.test(log)) {
    return currentMajor === 0 ? "minor" : "major";
  }
  if (/^feat(\([^)]*\))?:/m.test(log)) return "minor";
  return "patch";
};

const RANK = { patch: 0, minor: 1, major: 2 };

const main = () => {
  const baseFlag = process.argv.indexOf("--base");
  const base =
    baseFlag === -1
      ? git(["tag", "--list", "v*", "--sort=-v:refname"]).split("\n")[0]?.trim()
      : process.argv[baseFlag + 1];
  if (base === undefined || base.length === 0) {
    // A shallow or tagless checkout turns the whole gate into an unconditional pass, so say so
    // loudly rather than in a line nobody reads.
    console.log("::warning::No v* tag is reachable — this gate did not compare anything.");
    return 0;
  }

  const previous = exportedNames(git(["show", `${base}:${ENTRY}`]), base);
  const current = exportedNames(readFileSync(path.join(REPO_ROOT, ENTRY), "utf8"), "working tree");
  const known = (name) => current.values.has(name) || current.types.has(name);
  const removed = [...previous.values, ...previous.types].filter((name) => !known(name)).sort();
  // why: `export {` → `export type {` keeps the name set byte-identical, so tsc, attw and a
  // name-only diff all stay green while esbuild erases the binding from the bundle — a consumer
  // calling it gets `TypeError: … is not a function`. A demotion is as breaking as a deletion.
  const demoted = [...previous.values].filter((name) => current.types.has(name)).sort();

  const previousSubpaths = exportSubpaths(git(["show", `${base}:${MANIFEST}`]));
  const currentSubpaths = exportSubpaths(readFileSync(path.join(REPO_ROOT, MANIFEST), "utf8"));
  const removedSubpaths = [...previousSubpaths]
    .filter((subpath) => !currentSubpaths.has(subpath))
    .sort();

  const added = [...current.values, ...current.types]
    .filter((name) => !previous.values.has(name) && !previous.types.has(name))
    .sort();

  console.log(
    `Comparing ${ENTRY} against ${base}: ${previous.values.size} → ${current.values.size} value ` +
      `exports, ${previous.types.size} → ${current.types.size} type-only, ` +
      `${previousSubpaths.size} → ${currentSubpaths.size} exports subpaths.`,
  );
  if (added.length > 0) console.log(`Added (${added.length}): ${added.join(", ")}`);

  const breaks = [
    ...removed.map((name) => `export \`${name}\` was removed`),
    ...demoted.map((name) => `export \`${name}\` is now type-only, so it is erased at runtime`),
    ...removedSubpaths.map((subpath) => `exports subpath "${subpath}" was removed`),
  ];
  if (breaks.length === 0) {
    console.log("No exported name, runtime binding or exports subpath was removed.");
    return 0;
  }
  for (const entry of breaks) console.log(`Breaking: ${entry}`);

  const currentMajor = Number(
    JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version.split(".")[0],
  );
  const required = currentMajor === 0 ? "minor" : "major";
  const level = derivedLevel(`${base}..HEAD`, currentMajor);
  console.log(`Commits since ${base} derive a ${level} bump; a removal needs ${required}.`);
  if (RANK[level] >= RANK[required]) {
    console.log(`OK — the ${level} bump covers ${breaks.length} breaking change(s).`);
    return 0;
  }

  console.error(
    `::error::${breaks.length} breaking public-surface change(s) since ${base} but the commits ` +
      `only derive a ${level} bump. Mark the breaking commit (\`feat!:\` or a ` +
      `\`BREAKING CHANGE:\` footer) so the release bumps the ${required}, or revert: ` +
      breaks.join("; "),
  );
  return 1;
};

process.exit(main());
