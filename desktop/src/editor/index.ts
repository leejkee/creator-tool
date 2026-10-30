import { EditorApplication } from "./application";
import { createDesktopPort } from "./desktop";
import { createRenderer } from "./renderer";
import type { Ask, ChoosePath } from "./contracts";
export { createFileBrowserPort } from "./desktop";

export function createEditor(ask: Ask, choose: ChoosePath): EditorApplication {
  return new EditorApplication(
    createDesktopPort(choose),
    createRenderer(),
    ask,
  );
}
