import { MinecraftKitError, MinecraftKitErrorCodes } from "./errors";

/**
 * Parsed Maven coordinate of the form `group:artifact:version[:classifier][@extension]`.
 *
 * @internal
 */
export type MavenCoordinate = {
  readonly group: string;
  readonly artifact: string;
  readonly version: string;
  readonly classifier?: string;
  readonly extension: string;
};

/**
 * Parse a Maven coordinate string. Defaults `extension` to `jar`.
 *
 * @throws `INVALID_INPUT` when the input cannot be parsed.
 * @internal
 */
export const parseMavenCoordinate = (input: string): MavenCoordinate => {
  // Strip enclosing brackets used in Forge install profiles.
  const trimmed = input.startsWith("[") && input.endsWith("]") ? input.slice(1, -1) : input;
  const atIndex = trimmed.indexOf("@");
  const extension = atIndex === -1 ? "jar" : trimmed.slice(atIndex + 1);
  const body = atIndex === -1 ? trimmed : trimmed.slice(0, atIndex);
  const parts = body.split(":");
  if (parts.length < 3 || parts.length > 4) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `Invalid Maven coordinate: ${input}`,
      {
        context: { input },
      },
    );
  }
  const [group, artifact, version, classifier] = parts as [string, string, string, string?];
  if (!group || !artifact || !version) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.INVALID_INPUT,
      `Invalid Maven coordinate (missing component): ${input}`,
      { context: { input } },
    );
  }
  if (classifier === undefined) {
    return { group, artifact, version, extension };
  }
  return { group, artifact, version, classifier, extension };
};

/**
 * Build the relative path under a Maven repository for a coordinate.
 *
 * @internal
 */
export const mavenRelativePath = (coord: MavenCoordinate): string => {
  const groupPath = coord.group.replaceAll(".", "/");
  const classifierSegment = coord.classifier === undefined ? "" : `-${coord.classifier}`;
  const filename = `${coord.artifact}-${coord.version}${classifierSegment}.${coord.extension}`;
  return `${groupPath}/${coord.artifact}/${coord.version}/${filename}`;
};

/**
 * Convenience: parse + relative path.
 *
 * @internal
 */
export const mavenRelativePathFor = (input: string): string => {
  return mavenRelativePath(parseMavenCoordinate(input));
};
