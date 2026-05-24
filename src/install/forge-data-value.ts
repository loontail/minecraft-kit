/**
 * Pure decoders for Forge `install_profile.json#data[*].client` values. No filesystem
 * access — {@link decodeForgeDataValue} only inspects the leading prefix, and
 * {@link stripLiteralPrefix} only trims quote characters. Both are reused by
 * {@link "./forge-processor-plan"} during resolution and by tests.
 *
 * @internal
 * @packageDocumentation
 */

/**
 * Decoded shape of one `install_profile.json#data[key].client` entry: which of Forge's
 * four prefix conventions it matched, plus the substituted payload. The four shapes are
 * fully separable from filesystem I/O so the routing can be tested pure-functionally.
 *
 * @internal
 */
export type ForgeDataValueDecoded =
  /** `[g:a:v[:c]@ext]` — resolves to a path under `libraries/`. */
  | { readonly kind: "maven"; readonly coord: string }
  /** `'literal'` — both quotes stripped (matches Forge `Util.replaceTokens`). */
  | { readonly kind: "literal"; readonly value: string }
  /** `/path/inside/installer.ext` — entry to extract from the installer JAR. */
  | { readonly kind: "extract"; readonly entryName: string }
  /** Bare value — passed through verbatim. */
  | { readonly kind: "raw"; readonly value: string };

/**
 * Pure prefix-decoder for a Forge `install_profile.json` data value. The four prefix
 * conventions come from Forge's own `Util.replaceTokens` (see
 * `MinecraftForge/Installer src/main/java/net/minecraftforge/installer/json/Util.java`):
 * single-quote wrapping marks a literal, `[g:a:v]` a Maven coord, `/…` an entry inside
 * the installer JAR, and anything else is verbatim.
 *
 * Crucially, `'val'` strips BOTH quotes — not just the leading one. The trailing quote
 * matters because the data token can flow into processor `args` via `{KEY}` substitution
 * (not just into the `outputs` map, which gets a second pass of {@link stripLiteralPrefix}).
 *
 * @internal
 */
export const decodeForgeDataValue = (raw: string): ForgeDataValueDecoded => {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return { kind: "maven", coord: raw.slice(1, -1) };
  }
  if (raw.startsWith("'")) {
    return { kind: "literal", value: stripLiteralPrefix(raw) };
  }
  if (raw.startsWith("/")) {
    return { kind: "extract", entryName: raw.slice(1) };
  }
  return { kind: "raw", value: raw };
};

/**
 * Strip the single-quote wrapping that Forge `install_profile.json` puts around literal
 * values (in contrast to `{token}` placeholders and `[g:a:v]` maven coords). Both the
 * leading and trailing quote are removed when present.
 *
 * @internal
 */
export const stripLiteralPrefix = (value: string): string => {
  const stripped = value.startsWith("'") ? value.slice(1) : value;
  return stripped.endsWith("'") ? stripped.slice(0, -1) : stripped;
};
