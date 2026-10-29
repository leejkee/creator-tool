/** The only editor boundary that understands the image JSON field structure. */
import {
  validateRenderDocument,
  RENDER_DEFAULTS as D,
  DEFAULT_FONT_FAMILY,
} from "../render-input";
import type {
  EditorField,
  NewModuleInput,
  ModuleChoice,
  PendingMaterial,
} from "./contracts";

export interface RawModule extends Record<string, unknown> {
  id: string;
  type?: string;
  layout?: readonly [number, number];
  children?: {
    position: [number, number];
    module: RawModule;
    [key: string]: unknown;
  }[];
}
export interface WorkingDocument extends Record<string, unknown> {
  documentId: string;
  revision: number;
  composition: Record<string, unknown>;
  modules: RawModule[];
}
export interface IndexedModule {
  module: RawModule;
  parent?: RawModule;
  path: string;
  ancestors: string[];
}
export function documentCopy(payload: unknown): WorkingDocument {
  return structuredClone(payload) as WorkingDocument;
}
export function indexModules(doc: WorkingDocument): Map<string, IndexedModule> {
  const result = new Map<string, IndexedModule>();
  const stack = doc.modules.map((module, i) => ({
    module,
    path: `$.modules[${i}]`,
    ancestors: [] as string[],
    parent: undefined as RawModule | undefined,
  }));
  while (stack.length) {
    const entry = stack.pop()!;
    result.set(entry.module.id, entry);
    for (const [i, child] of (entry.module.children ?? []).entries()) {
      stack.push({
        module: child.module,
        parent: entry.module,
        path: `${entry.path}.children[${i}].module`,
        ancestors: [...entry.ancestors, entry.module.id],
      });
    }
  }
  return result;
}
export function kindName(node: RawModule): string {
  return node.layout !== undefined
    ? "布局模块"
    : ({ image: "图片", text: "文本框", rect: "矩形" }[node.type ?? ""] ??
        "未知模块");
}
export function nodeName(node: RawModule): string {
  const title = typeof node.title === "string" ? node.title : undefined;
  const text =
    node.type === "text" && typeof node.text === "string"
      ? node.text.trim().slice(0, 20)
      : undefined;
  return title || text || `${kindName(node)} · ${node.id.slice(0, 8)}`;
}
export function parents(doc: WorkingDocument): ModuleChoice[] {
  if (!doc.modules.length) {
    return [{ id: "", label: "作为文档根模块" }];
  }
  const choices = [...indexModules(doc).values()]
    .filter((e) => e.module.layout !== undefined)
    .map((e) => ({ id: e.module.id, label: nodeName(e.module) }));
  return choices.length
    ? choices
    : [{ id: "$wrap", label: "创建外层布局，保留已有内容并添加新模块" }];
}
interface Binding {
  keys: string[];
  type: "string" | "number" | "boolean" | "json" | "size";
  required?: boolean;
}
const bindings = new Map<string, Binding>();
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function get(value: unknown, keys: readonly string[]): unknown {
  for (const key of keys) {
    value = object(value)[key];
  }
  return value;
}
function stringValue(value: unknown): string {
  return value === undefined
    ? ""
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
}
function set(
  value: Record<string, unknown>,
  keys: readonly string[],
  next: unknown,
): void {
  let target = value;
  for (const key of keys.slice(0, -1)) {
    target = target[key] = { ...object(target[key]) };
  }
  const key = keys[keys.length - 1];
  if (next === undefined) {
    delete target[key];
  } else {
    target[key] = next;
  }
}
const option = (values: string[], labels: string[]) =>
  values.map((value, i) => ({ value, label: labels[i] }));
const horizontal = option(
  ["left", "center", "right"],
  ["左对齐", "居中", "右对齐"],
);
const vertical = option(["top", "center", "bottom"], ["顶部", "居中", "底部"]);
const fits = option(
  ["contain", "cover", "stretch", "height", "width"],
  ["等比完整显示", "等比铺满", "拉伸", "适配高度", "适配宽度"],
);

export function fieldsFor(
  doc: WorkingDocument,
  id: string,
  draft: ReadonlyMap<string, string>,
  errors: ReadonlyMap<string, string>,
  fonts: readonly string[],
): EditorField[] {
  const entry = indexModules(doc).get(id);
  if (!entry) {
    return [];
  }
  const node = entry.module;
  const fields: EditorField[] = [];
  const add = (
    id: string,
    label: string,
    section: string,
    keys: string[],
    type: Binding["type"],
    kind: EditorField["kind"] = "text",
    fallback?: unknown,
    choices?: EditorField["options"],
    required = false,
  ) => {
    bindings.set(id, { keys, type, required });
    const source = keys[0] === "$output" ? doc.composition : node;
    const actualKeys = keys[0] === "$output" ? keys.slice(1) : keys;
    fields.push({
      id,
      label,
      section,
      kind,
      value: draft.get(id) ?? stringValue(get(source, actualKeys)),
      placeholder:
        fallback === undefined
          ? required
            ? "必填"
            : "未设置"
          : `默认：${fallback}`,
      options: choices,
      error: errors.get(id),
    });
  };
  if (node.layout !== undefined) {
    add(
      "layout.rows",
      "行数",
      "布局",
      ["layout", "0"],
      "number",
      "number",
      undefined,
      undefined,
      true,
    );
    add(
      "layout.columns",
      "列数",
      "布局",
      ["layout", "1"],
      "number",
      "number",
      undefined,
      undefined,
      true,
    );
    // Tuples are read as arrays rather than objects.
    fields[0].value = draft.get("layout.rows") ?? String(node.layout[0]);
    fields[1].value = draft.get("layout.columns") ?? String(node.layout[1]);
    add(
      "layout.padding",
      "内边距",
      "布局",
      ["padding"],
      "number",
      "number",
      D.modulePadding,
    );
    add(
      "layout.gap",
      "模块间距",
      "布局",
      ["gap"],
      "number",
      "number",
      D.moduleGap,
    );
  } else {
    add(
      "box.width",
      "宽度",
      "尺寸",
      ["width"],
      "number",
      "number",
      undefined,
      undefined,
      true,
    );
    add(
      "box.height",
      "高度",
      "尺寸",
      ["height"],
      "number",
      "number",
      undefined,
      undefined,
      true,
    );
  }
  if (node.type === "text") {
    add(
      "text.content",
      "文字内容",
      "内容",
      ["text"],
      "string",
      "multiline",
      undefined,
      undefined,
      true,
    );
    add(
      "text.size",
      "字号",
      "文字",
      ["style", "fontSize"],
      "number",
      "number",
      D.fontSize,
    );
    add(
      "text.font",
      "字体",
      "文字",
      ["style", "fontFamily"],
      "string",
      "font",
      DEFAULT_FONT_FAMILY,
      option([...fonts], [...fonts]),
    );
    add(
      "text.bold",
      "加粗",
      "文字",
      ["style", "bold"],
      "boolean",
      "select",
      D.bold,
      option(["true", "false"], ["是", "否"]),
    );
    add(
      "text.color",
      "文字颜色",
      "文字",
      ["style", "color"],
      "string",
      "text",
      D.textColor,
    );
    add(
      "text.lineHeight",
      "行高（像素）",
      "文字",
      ["style", "lineHeight"],
      "number",
      "number",
      "字号 × 1.2",
    );
    add(
      "text.wrap",
      "自动换行",
      "文字",
      ["style", "wrap"],
      "boolean",
      "select",
      D.wrap,
      option(["true", "false"], ["开启", "关闭"]),
    );
  }
  if (node.type === "image") {
    add("image.source", "本地图片", "内容", ["assetPath"], "string", "asset");
    add(
      "image.fit",
      "适配方式",
      "图片",
      ["fit"],
      "string",
      "select",
      "contain",
      fits,
    );
    add(
      "image.processors",
      "图片处理顺序",
      "图片处理",
      ["processors"],
      "json",
      "code",
      "[]",
    );
  }
  if (node.type === "image" || node.type === "text") {
    add(
      "content.align",
      "水平对齐",
      "内容区",
      ["style", "align"],
      "string",
      "select",
      node.type === "text" ? D.textAlign : D.imageAlign,
      horizontal,
    );
    add(
      "content.vertical",
      "垂直对齐",
      "内容区",
      ["style", "verticalAlign"],
      "string",
      "select",
      D.verticalAlign,
      vertical,
    );
    add(
      "content.padding",
      "内容内边距",
      "内容区",
      ["style", "padding"],
      "number",
      "number",
      D.contentPadding,
    );
  }
  add(
    "appearance.radius",
    "圆角",
    "外观",
    ["style", "radius"],
    "number",
    "number",
    D.radius,
  );
  add(
    "appearance.opacity",
    "不透明度（0–1）",
    "外观",
    ["style", "opacity"],
    "number",
    "number",
    D.opacity,
  );
  add(
    "border.enabled",
    "边框",
    "外观",
    ["style", "border"],
    "boolean",
    "select",
    false,
    option(["true", "false"], ["启用", "关闭"]),
  );
  fields[fields.length - 1].value =
    draft.get("border.enabled") ??
    (get(node, ["style", "border"]) === undefined ? "" : "true");
  if (
    (draft.get("border.enabled") ??
      (get(node, ["style", "border"]) === undefined ? "" : "true")) === "true"
  ) {
    add(
      "border.width",
      "边框宽度",
      "外观",
      ["style", "border", "width"],
      "number",
      "number",
      D.borderWidth,
    );
    add(
      "border.color",
      "边框颜色",
      "外观",
      ["style", "border", "color"],
      "string",
      "text",
      D.borderColor,
    );
  }
  add(
    "background.kind",
    "背景",
    "背景",
    ["style", "background", "type"],
    "string",
    "select",
    "透明",
    option(["color", "image"], ["纯色", "图片"]),
  );
  const backgroundType =
    draft.get("background.kind") ?? get(node, ["style", "background", "type"]);
  if (backgroundType === "color") {
    add(
      "background.color",
      "背景颜色",
      "背景",
      ["style", "background", "color"],
      "string",
      "text",
      undefined,
      undefined,
      true,
    );
  } else if (backgroundType === "image") {
    add(
      "background.source",
      "背景图片",
      "背景",
      ["style", "background", "assetPath"],
      "string",
      "asset",
    );
    add(
      "background.fit",
      "背景适配",
      "背景",
      ["style", "background", "fit"],
      "string",
      "select",
      D.backgroundFit,
      fits,
    );
    add(
      "background.align",
      "背景水平对齐",
      "背景",
      ["style", "background", "align"],
      "string",
      "select",
      D.imageAlign,
      horizontal,
    );
    add(
      "background.vertical",
      "背景垂直对齐",
      "背景",
      ["style", "background", "verticalAlign"],
      "string",
      "select",
      D.verticalAlign,
      vertical,
    );
  }
  if (!entry.parent) {
    add(
      "output.width",
      "输出宽度",
      "最终 PNG",
      ["$output", "width"],
      "size",
      "text",
      "auto",
    );
    add(
      "output.height",
      "输出高度",
      "最终 PNG",
      ["$output", "height"],
      "size",
      "text",
      "auto",
    );
  }
  const processor = fields.find((field) => field.id === "image.processors");
  if (processor) {
    processor.hint =
      '按顺序执行，例如：\n[["image-tools.blurImage", {"blurRadius": 8}]]';
  }
  return fields;
}

export class FieldFailure extends Error {
  constructor(readonly errors: Map<string, string>) {
    super("有非法值，请修正后再应用");
  }
}
export function applyFields(
  doc: WorkingDocument,
  id: string,
  draft: ReadonlyMap<string, string>,
): WorkingDocument {
  const next = documentCopy(doc);
  const entry = indexModules(next).get(id);
  if (!entry) {
    throw new Error("模块已不存在");
  }
  const errors = new Map<string, string>();
  const node = entry.module;
  const visible = new Set(
    fieldsFor(doc, id, draft, new Map(), []).map((field) => field.id),
  );
  const priority = (key: string): number =>
    key === "border.enabled" || key === "background.kind" ? 0 : 1;
  for (const [key, input] of [...draft].sort(
    ([a], [b]) => priority(a) - priority(b),
  )) {
    if (!visible.has(key)) {
      continue;
    }
    const binding = bindings.get(key);
    if (!binding) {
      continue;
    }
    let value: unknown = input;
    if (!input.length && !binding.required) {
      value = undefined;
    } else if (binding.type === "number" || binding.type === "size") {
      if (binding.type === "size" && input === "auto") {
        value = "auto";
      } else if (!input.trim() || !Number.isFinite(Number(input))) {
        errors.set(key, "请输入合法数值");
        continue;
      } else {
        value = Number(input);
      }
    } else if (binding.type === "boolean") {
      if (input !== "true" && input !== "false") {
        errors.set(key, "请选择合法值");
        continue;
      }
      value = input === "true";
    } else if (binding.type === "json") {
      try {
        value = JSON.parse(input);
      } catch {
        errors.set(key, "JSON 格式非法");
        continue;
      }
    }
    if (
      key.startsWith("layout.") &&
      ["layout.rows", "layout.columns"].includes(key)
    ) {
      const layout: [unknown, unknown] = [...(node.layout ?? [1, 1])];
      layout[key === "layout.rows" ? 0 : 1] = value;
      node.layout = layout as [number, number];
    } else if (key === "border.enabled") {
      set(
        node,
        ["style", "border"],
        value === true ? object(get(node, ["style", "border"])) : undefined,
      );
    } else if (key === "background.kind") {
      const previous = object(get(node, ["style", "background"]));
      set(
        node,
        ["style", "background"],
        value === undefined
          ? undefined
          : previous.type === value
            ? previous
            : {
                ...Object.fromEntries(
                  Object.entries(previous).filter(
                    ([key]) =>
                      ![
                        "type",
                        "color",
                        "assetPath",
                        "fit",
                        "align",
                        "verticalAlign",
                      ].includes(key),
                  ),
                ),
                type: value,
              },
      );
    } else if (binding.keys[0] === "$output") {
      set(next.composition, binding.keys.slice(1), value);
    } else {
      set(node, binding.keys, value);
    }
  }
  const validation = validateRenderDocument(next);
  if (!validation.ok) {
    for (const issue of validation.errors) {
      if (
        issue.moduleId !== id &&
        !(issue.path.startsWith("$.composition") && !entry.parent)
      ) {
        continue;
      }
      const field = [...bindings.entries()].find(([, b]) => {
        const path =
          b.keys[0] === "$output"
            ? `$.composition.${b.keys.slice(1).join(".")}`
            : b.keys[0] === "layout"
              ? `${entry.path}.layout[${b.keys[1]}]`
              : `${entry.path}.${b.keys.join(".")}`;
        return issue.path === path || issue.path.startsWith(`${path}[`);
      });
      errors.set(
        field?.[0] ?? (node.layout ? "layout.rows" : "box.width"),
        issue.message,
      );
    }
  }
  if (errors.size) {
    throw new FieldFailure(errors);
  }
  return next;
}

export function materialPaths(
  doc: WorkingDocument,
): Map<
  string,
  { moduleId: string; slot: PendingMaterial["slot"]; path: string }
> {
  const result = new Map<
    string,
    { moduleId: string; slot: PendingMaterial["slot"]; path: string }
  >();
  for (const { module } of indexModules(doc).values()) {
    for (const [slot, path] of [
      ["image", module.type === "image" ? module.assetPath : undefined],
      ["background", get(module, ["style", "background", "assetPath"])],
    ] as const) {
      if (typeof path === "string" && path.trim()) {
        result.set(`${module.id}:${slot}`, { moduleId: module.id, slot, path });
      }
    }
  }
  return result;
}

export function addModule(
  doc: WorkingDocument,
  input: NewModuleInput,
): { document: WorkingDocument; id: string } {
  const next = documentCopy(doc);
  const id = crypto.randomUUID();
  const module: RawModule = { id };
  if (input.kind === "layout") {
    module.layout = [1, 1];
    module.children = [];
  } else {
    const width = Number(input.width),
      height = Number(input.height);
    if (
      !Number.isSafeInteger(width) ||
      width <= 0 ||
      !Number.isSafeInteger(height) ||
      height <= 0
    ) {
      throw new Error("宽高必须填写正安全整数");
    }
    module.type = input.kind;
    module.width = width;
    module.height = height;
    if (input.kind === "text") {
      module.text = input.text;
    }
  }
  if (!next.modules.length) {
    next.modules.push(module);
    return { document: next, id };
  }
  const row = Number(input.row),
    column = Number(input.column);
  if (
    !input.row.trim() ||
    !input.column.trim() ||
    !Number.isInteger(row) ||
    row < 0 ||
    row >= 0xffffffff ||
    !Number.isInteger(column) ||
    column < 0 ||
    column >= 0xffffffff
  ) {
    throw new Error("行列位置必须为网格范围内的非负整数（从 0 开始）");
  }
  let parent = indexModules(next).get(input.parentId)?.module;
  if (input.parentId === "$wrap") {
    parent = {
      id: crypto.randomUUID(),
      layout: [1, 1],
      children: [{ position: [0, 0], module: next.modules[0] }],
    };
    next.modules = [parent];
  }
  if (!parent?.layout) {
    throw new Error("请选择具有布局的父模块");
  }
  if (
    parent.children?.some(
      (p) => p.position[0] === row && p.position[1] === column,
    )
  ) {
    throw new Error("该位置已被占用，请选择其他位置");
  }
  parent.children ??= [];
  parent.children.push({ position: [row, column], module });
  parent.layout = [
    Math.max(parent.layout[0], row + 1),
    Math.max(parent.layout[1], column + 1),
  ];
  return { document: next, id };
}
export function removeModule(
  doc: WorkingDocument,
  id: string,
): { document: WorkingDocument; count: number; parentId?: string } {
  const next = documentCopy(doc);
  const entry = indexModules(next).get(id);
  if (!entry) {
    throw new Error("模块已不存在");
  }
  const count = [...indexModules(next).values()].filter(
    (e) => e.module.id === id || e.ancestors.includes(id),
  ).length;
  if (entry.parent) {
    entry.parent.children = entry.parent.children?.filter(
      (p) => p.module.id !== id,
    );
  } else {
    next.modules = [];
  }
  return { document: next, count, parentId: entry.parent?.id };
}

export function moveModule(
  doc: WorkingDocument,
  id: string,
  parentId: string,
  row: number,
  column: number,
): WorkingDocument {
  const before = indexModules(doc).get(id);
  if (!before) {
    throw new Error("模块已不存在");
  }
  const destination = indexModules(doc).get(parentId);
  if (
    !destination?.module.layout ||
    parentId === id ||
    destination.ancestors.includes(id)
  ) {
    throw new Error("目标父模块非法，不能移动到自身或后代模块中");
  }
  if (
    !Number.isInteger(row) ||
    row < 0 ||
    row >= 0xffffffff ||
    !Number.isInteger(column) ||
    column < 0 ||
    column >= 0xffffffff
  ) {
    throw new Error("请输入合法的行列位置");
  }
  if (
    destination.module.children?.some(
      (p) =>
        p.module.id !== id && p.position[0] === row && p.position[1] === column,
    )
  ) {
    throw new Error("目标位置已被占用");
  }
  const next = removeModule(doc, id).document;
  const target = indexModules(next).get(parentId)!.module;
  target.children ??= [];
  const originalPlacement = before.parent?.children?.find(
    (placed) => placed.module.id === id,
  );
  target.children.push({
    ...structuredClone(originalPlacement),
    position: [row, column],
    module: structuredClone(before.module),
  });
  target.layout = [
    Math.max(target.layout![0], row + 1),
    Math.max(target.layout![1], column + 1),
  ];
  return next;
}
