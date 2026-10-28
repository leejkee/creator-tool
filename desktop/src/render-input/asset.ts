const URI_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/i;

/** Validate assetPath without resolving directories, reading files, or changing JSON. */
export function resolveLocalImagePath(assetPath?: unknown): string | undefined {
  if (assetPath === undefined) {
    return undefined;
  }
  if (typeof assetPath !== "string") {
    throw new TypeError("assetPath must be a local filesystem path string");
  }
  const candidate = assetPath.trim();
  if (candidate.length === 0) {
    return undefined;
  }
  if (assetPath.includes("\0")) {
    throw new TypeError("assetPath must not contain a null character");
  }
  if (URI_SCHEME.test(candidate) && !WINDOWS_ABSOLUTE_PATH.test(candidate)) {
    throw new TypeError("assetPath must be a local filesystem path, not a URI");
  }
  return assetPath;
}
