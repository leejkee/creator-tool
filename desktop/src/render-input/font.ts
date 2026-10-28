/** Generic CSS family: the WebView selects the actual system font and fallback. */
export const DEFAULT_FONT_FAMILY = "sans-serif";

/** Resolve style.fontFamily without scanning fonts or changing the document. */
export function resolveFontFamily(fontFamily?: unknown): string {
  if (fontFamily === undefined) {
    return DEFAULT_FONT_FAMILY;
  }
  if (typeof fontFamily !== "string" || fontFamily.trim().length === 0) {
    throw new TypeError("style.fontFamily must be a nonempty string");
  }
  return fontFamily;
}
