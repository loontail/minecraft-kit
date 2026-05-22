/**
 * Extract every `<version>...</version>` element from a Maven `maven-metadata.xml`. The
 * structure is rigid enough that a regex-based extractor is robust here — no full XML parser
 * dependency required.
 *
 * @internal
 */
export const parseMavenMetadataVersions = (xml: string): readonly string[] => {
  const versions: string[] = [];
  const regex = /<version>\s*([^<]+?)\s*<\/version>/g;
  for (const match of xml.matchAll(regex)) {
    if (match[1]) versions.push(match[1]);
  }
  return versions;
};
