/**
 * Fail when `src/index.ts` drops an exported name without the release bump that a consumer
 * pinned on a caret range needs to be shielded from it.
 *
 * The release workflow already derives the bump level from the conventional commits since the
 * last `v*` tag. That derivation only sees commit *subjects*: a `fix:` or `refactor:` that
 * happens to delete an exported symbol releases as a patch, and every consumer on
 * `^currentVersion` is handed a compile break on `npm update`. This is the second net — it
 * compares the actual exported-name set against the last release and insists the derived level
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

const git = (args) =>
  execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/** Every name `source` exports, following `as` aliases to the externally visible name. */
const exportedNames = (source, label) => {
  const file = ts.createSourceFile(ENTRY, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const names = new Set();
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause === undefined) {
        // `export * from "…"` hides the name set from a static reader, which would let a removal
        // through unseen. Refuse rather than under-report.
        throw new Error(`${label}: ${ENTRY} uses \`export *\`, which this check cannot resolve`);
      }
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.add(element.name.text);
      } else {
        names.add(statement.exportClause.name.text);
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
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
      continue;
    }
    if (statement.name !== undefined && ts.isIdentifier(statement.name)) {
      names.add(statement.name.text);
    }
  }
  return names;
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
    console.log("No v* tag found — nothing to compare against.");
    return 0;
  }

  const previous = exportedNames(git(["show", `${base}:${ENTRY}`]), base);
  const current = exportedNames(readFileSync(path.join(REPO_ROOT, ENTRY), "utf8"), "working tree");
  const removed = [...previous].filter((name) => !current.has(name)).sort();
  const added = [...current].filter((name) => !previous.has(name)).sort();

  console.log(`Comparing ${ENTRY} against ${base}: ${previous.size} → ${current.size} exports.`);
  if (added.length > 0) console.log(`Added (${added.length}): ${added.join(", ")}`);
  if (removed.length === 0) {
    console.log("No exported name was removed.");
    return 0;
  }
  console.log(`Removed (${removed.length}): ${removed.join(", ")}`);

  const currentMajor = Number(
    JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version.split(".")[0],
  );
  const required = currentMajor === 0 ? "minor" : "major";
  const level = derivedLevel(`${base}..HEAD`, currentMajor);
  console.log(`Commits since ${base} derive a ${level} bump; a removal needs ${required}.`);
  if (RANK[level] >= RANK[required]) {
    console.log(`OK — the ${level} bump covers the removal.`);
    return 0;
  }

  console.error(
    `::error::${removed.length} exported name(s) disappeared from ${ENTRY} but the commits ` +
      `since ${base} only derive a ${level} bump. Mark the breaking commit (\`feat!:\` or a ` +
      `\`BREAKING CHANGE:\` footer) so the release bumps the ${required}, or restore: ` +
      removed.join(", "),
  );
  return 1;
};

process.exit(main());
