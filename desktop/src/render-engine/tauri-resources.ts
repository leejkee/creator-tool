import { invoke } from "@tauri-apps/api/core";
import type { RenderResourceProvider } from "./types";

/** Explicit adapter: Engine itself has no dependency on an open Tauri document session. */
export function createTauriRenderResources(): RenderResourceProvider {
  return {
    async readAsset(assetPath, documentDirectory) {
      const asset = await invoke<{ bytes: number[]; version: string }>(
        "read_render_asset",
        {
          assetPath,
          documentDirectory,
        },
      );
      return { bytes: new Uint8Array(asset.bytes), version: asset.version };
    },
    assetVersion(assetPath, documentDirectory) {
      return invoke<string | null>("get_render_asset_version", {
        assetPath,
        documentDirectory,
      });
    },
  };
}
