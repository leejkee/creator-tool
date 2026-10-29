import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { EditorApplication } from "./application";

/** Native window policy stays outside the Vue components. */
export async function protectWindowClose(
  editor: EditorApplication,
  canClose: () => boolean,
): Promise<() => void> {
  if (!isTauri()) {
    return () => {};
  }
  const window = getCurrentWindow();
  let closing = false;
  return window.onCloseRequested(async (event) => {
    event.preventDefault();
    if (closing || !canClose()) {
      return;
    }
    closing = true;
    try {
      if (await editor.prepareLeave()) {
        await window.destroy();
      }
    } catch (error) {
      editor.reportError(error);
    } finally {
      closing = false;
    }
  });
}
