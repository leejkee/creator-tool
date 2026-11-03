/** Resource/document adaptation. UI components only see the library contracts. */
import type { LibraryKind, NewModuleKind } from "./contracts";
import { documentCopy, indexModules } from "./protocol";
import type { RawModule, WorkingDocument } from "./protocol";

const parameters = [
  "width",
  "height",
  "fit",
  "padding",
  "gap",
  "contentScale",
  "offsetX",
  "offsetY",
  "zIndex",
  "rowGap",
  "columnGap",
  "processors",
];
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function merge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const current = object(target[key]);
      target[key] = current;
      merge(current, object(value));
    } else {
      target[key] = structuredClone(value);
    }
  }
}
function styleParameters(
  node: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of parameters) {
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      result[key] = structuredClone(node[key]);
    }
  }
  if (node.style !== undefined) {
    result.style = structuredClone(node.style);
    const background = object(object(result.style).background);
    delete background.assetPath;
  }
  return result;
}
function recipe(node: RawModule): Record<string, unknown> {
  const result = styleParameters(node);
  if (node.type !== undefined && node.$styleUntyped !== true) {
    result.type = node.type;
  }
  if (node.layout !== undefined && node.$styleImplicitLayout !== true) {
    result.layout = [...node.layout];
  }
  if (node.children?.length) {
    result.children = node.children.map((child) => ({
      position: [...child.position],
      module: recipe(child.module),
    }));
  }
  return result;
}
export function styleResource(node: RawModule): unknown {
  return { resourceKind: "style", module: recipe(node) };
}
function recipeRoot(payload: unknown): Record<string, unknown> {
  const envelope = object(payload);
  if (
    envelope.resourceKind !== "style" ||
    envelope.module === null ||
    typeof envelope.module !== "object" ||
    Array.isArray(envelope.module)
  ) {
    throw new Error(
      "Style 资源必须包含 resourceKind: style 和 module 参数配方",
    );
  }
  return object(envelope.module);
}
export function emptyResource(
  kind: LibraryKind,
  moduleKind: NewModuleKind,
): WorkingDocument {
  const root: RawModule = { id: crypto.randomUUID() };
  if (moduleKind === "layout") {
    root.layout = [1, 1];
    root.children = [];
  } else {
    root.type = moduleKind;
    if (kind === "template") {
      root.width = 480;
      root.height = moduleKind === "text" ? 120 : 320;
      if (moduleKind === "text") {
        root.text = "在这里写下你的想法";
      }
    }
  }
  return {
    "image-create-tool-version": "v0.2.0",
    documentId: crypto.randomUUID(),
    revision: 0,
    composition: {},
    modules: [root],
  };
}
export function templateResource(
  doc: WorkingDocument,
  selected?: string,
): WorkingDocument {
  const next = documentCopy(doc);
  if (selected) {
    const module = indexModules(next).get(selected)?.module;
    if (!module) {
      throw new Error("请选择要保存为模板的模块");
    }
    next.modules = [module];
    next.composition = {};
  }
  for (const { module } of indexModules(next).values()) {
    if (module.type === "image") {
      module.assetPath = "demo.png";
    }
    const background = object(object(module.style).background);
    if (background.type === "image") {
      background.assetPath = "demo.png";
    }
  }
  return next;
}
export function resourceDocument(
  kind: LibraryKind,
  payload: unknown,
): WorkingDocument {
  if (kind === "template") {
    const raw = object(payload);
    if (!Array.isArray(raw.modules) || typeof raw.documentId !== "string") {
      throw new Error("模板不是完整图片 JSON");
    }
    return templateResource(documentCopy(raw));
  }
  const build = (raw: Record<string, unknown>, id: string): RawModule => {
    const children = Array.isArray(raw.children) ? raw.children : [];
    const node = { ...styleParameters(raw), id } as RawModule;
    if (raw.type !== undefined) {
      node.type = String(raw.type);
    } else {
      node.$styleUntyped = true;
    }
    if (raw.layout !== undefined) {
      node.layout = structuredClone(raw.layout) as [number, number];
    } else if (children.length) {
      node.layout = [1, 1];
      node.$styleImplicitLayout = true;
    } else {
      node.type ??= "rect";
    }
    if (children.length) {
      node.children = children.map((child, i) => {
        const placed = object(child);
        const position = placed.position;
        if (
          !Array.isArray(position) ||
          position.length !== 2 ||
          !position.every(
            (n) => Number.isInteger(n) && n >= 0 && n <= 4294967295,
          )
        ) {
          throw new Error("Style 子配方必须提供有效的行列位置");
        }
        if (node.$styleImplicitLayout === true) {
          node.layout = [
            Math.max(node.layout![0], position[0] + 1),
            Math.max(node.layout![1], position[1] + 1),
          ];
        }
        return {
          position: [...position] as [number, number],
          module: build(object(placed.module), `${id}-${i}`),
        };
      });
    }
    return node;
  };
  return {
    "image-create-tool-version": "v0.2.0",
    documentId: "style-preview",
    revision: 0,
    composition: {},
    modules: [build(recipeRoot(payload), "style-root")],
  };
}
export function resourcePayload(
  kind: LibraryKind,
  doc: WorkingDocument,
): unknown {
  if (kind === "template") {
    return templateResource(doc);
  }
  if (!doc.modules[0]) {
    throw new Error("Style 至少需要一个参数配方根模块");
  }
  return styleResource(doc.modules[0]);
}
export function resourcePreview(
  kind: LibraryKind,
  doc: WorkingDocument,
  demoPath: string,
): WorkingDocument {
  const next = templateResource(doc);
  for (const { module } of indexModules(next).values()) {
    if (kind === "style") {
      if (!module.layout) {
        if (module.width === undefined) {
          module.width = 480;
        }
        if (module.height === undefined) {
          module.height = module.type === "text" ? 120 : 320;
        }
      }
      if (module.type === "text") {
        module.text = "样式预览 · 把想法排成图片";
      }
      const background = object(object(module.style).background);
      if (background.type === "color") {
        if (background.color === undefined) {
          background.color = "#F4F7F5";
        }
      }
    }
    if (module.type === "image") {
      module.assetPath = demoPath;
    }
    const background = object(object(module.style).background);
    if (background.type === "image") {
      background.assetPath = demoPath;
    }
  }
  return next;
}
export function applyStyleResource(
  doc: WorkingDocument,
  id: string,
  payload: unknown,
): WorkingDocument {
  const next = documentCopy(doc);
  const node = indexModules(next).get(id)?.module;
  if (!node) {
    throw new Error("请选择要应用 Style 的模块");
  }
  const apply = (target: RawModule, patch: Record<string, unknown>): void => {
    for (const key of parameters) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        target[key] = structuredClone(patch[key]);
      }
    }
    if (Object.keys(object(patch.style)).length) {
      target.style = structuredClone(object(target.style));
      merge(object(target.style), object(patch.style));
    }
    const children = new Map<string, Record<string, unknown>>();
    for (const raw of Array.isArray(patch.children) ? patch.children : []) {
      const child = object(raw);
      children.set(JSON.stringify(child.position), object(child.module));
    }
    for (const child of target.children ?? []) {
      const recipe = children.get(JSON.stringify(child.position));
      if (recipe) {
        apply(child.module, recipe);
      }
    }
  };
  apply(node, recipeRoot(payload));
  return next;
}
