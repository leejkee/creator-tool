/** Format paths in UI text without changing stored paths or file operations. */
export function displayPath(value = ""): string {
  return value
    .replace(/\\\\\?\\UNC\\/gi, "\\\\")
    .replace(/\\\\\?\\(?=[a-z]:\\)/gi, "");
}
