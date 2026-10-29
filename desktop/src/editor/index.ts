import { EditorApplication } from "./application";
import { createDesktopPort } from "./desktop";
import { createRenderer } from "./renderer";
import type { Ask } from "./contracts";

export function createEditor(ask: Ask): EditorApplication {
  return new EditorApplication(createDesktopPort(), createRenderer(), ask);
}
