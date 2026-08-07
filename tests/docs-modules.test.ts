import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..");

const readModulesDoc = (): Promise<string> =>
  fs.readFile(path.join(REPO_ROOT, "docs", "modules.md"), "utf8");

const listSourceDirectories = async (relative: string): Promise<string[]> => {
  const absolute = path.join(REPO_ROOT, relative);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = `${relative}/${entry.name}`;
    found.push(child);
    found.push(...(await listSourceDirectories(child)));
  }
  return found;
};

describe("docs/modules.md", () => {
  it("has a section for every directory under src/", async () => {
    const doc = await readModulesDoc();
    const directories = await listSourceDirectories("src");
    const undocumented = directories.filter((dir) => !doc.includes(`\`${dir}/\``));
    expect(undocumented).toEqual([]);
  });

  it("names no source path that does not exist", async () => {
    const doc = await readModulesDoc();
    const cited = new Set(
      [...doc.matchAll(/`(src\/[A-Za-z0-9._/-]+\.ts)`/g)].map((match) => match[1] as string),
    );
    const missing: string[] = [];
    for (const filePath of cited) {
      const exists = await fs
        .stat(path.join(REPO_ROOT, filePath))
        .then(() => true)
        .catch(() => false);
      if (!exists) missing.push(filePath);
    }
    expect(missing.sort()).toEqual([]);
  });
});
