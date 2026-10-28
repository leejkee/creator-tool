import { invoke } from "@tauri-apps/api/core";

/** Read sorted, unique installed family names; call on startup or explicit refresh. */
export function listLocalFontFamilies(): Promise<readonly string[]> {
  return invoke<string[]>("list_local_font_families");
}
