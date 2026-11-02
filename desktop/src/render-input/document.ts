import type { GridPosition, ModuleType } from "../types";
import { RENDER_DEFAULTS as D } from "./defaults";
import { IMAGE_RENDER_DEFAULTS, resolveImageFit } from "./image";
import { resolveProcessors } from "./processors";
import { imagePath, resolveModuleStyle, validateContentBox } from "./style";
import type {
  RenderLayoutModule,
  RenderModule,
  RenderValidationResult,
} from "./types";
import {
  array,
  attempt,
  enumeration,
  error,
  integer,
  object,
  string,
  unknownFields,
  unsupportedFields,
} from "./validation";
import type { Fields, ValidationContext } from "./validation";

const LEGACY_ASSETS = ["assetId", "assetQuery", "assetsDir", "assetAliases"];
const UNSUPPORTED_MODULE_FIELDS = [
  "elements",
  "position",
  "span",
  "processor",
  "contentScale",
  "offsetX",
  "offsetY",
  "z",
  "zIndex",
  "rowGap",
  "columnGap",
];
const MODULE_TYPES = ["text", "image", "rect"] as const;

interface Slot {
  value?: RenderModule;
}
interface ChildSlot {
  readonly position: GridPosition;
  readonly slot: Slot;
}
type Frame =
  | {
      readonly kind: "visit";
      readonly raw: unknown;
      readonly path: string;
      readonly slot: Slot;
    }
  | {
      readonly kind: "finish";
      readonly raw: Fields;
      readonly parent: Omit<RenderLayoutModule, "children">;
      readonly children: readonly ChildSlot[];
      readonly slot: Slot;
    };

function gridPair(
  value: unknown,
  path: string,
  ctx: ValidationContext,
  minimum: number,
): GridPosition | undefined {
  const before = ctx.errors.length;
  const pair = array(value, path, ctx);
  if (pair.length !== 2) {
    error(ctx, path, "必须是恰好包含两个整数的二元组");
  }
  const first = integer(pair[0], `${path}[0]`, ctx, minimum);
  const second = integer(pair[1], `${path}[1]`, ctx, minimum);
  if (first > 0xffffffff || second > 0xffffffff) {
    error(ctx, path, "网格数值不能超过 u32 范围");
  }
  return before === ctx.errors.length ? [first, second] : undefined;
}

function outputSize(
  value: unknown,
  path: string,
  ctx: ValidationContext,
): number | "auto" {
  if (value === undefined || value === "auto") {
    return D.outputSize;
  }
  return integer(value, path, ctx, 1);
}

function children(
  fields: Fields,
  layout: GridPosition | undefined,
  path: string,
  ctx: ValidationContext,
): { slots: ChildSlot[]; visits: Frame[] } {
  const records = array(fields.children, `${path}.children`, ctx, true);
  const slots: ChildSlot[] = [];
  const visits: Frame[] = [];
  const occupied = new Set<string>();
  for (let i = 0; i < records.length; i++) {
    const recordPath = `${path}.children[${i}]`;
    const placed = object(records[i], recordPath, ctx);
    if (!placed) {
      continue;
    }
    unsupportedFields(placed, ["span"], recordPath, ctx);
    const position = gridPair(
      placed.position,
      `${recordPath}.position`,
      ctx,
      0,
    );
    if (position) {
      const key = `${position[0]},${position[1]}`;
      if (occupied.has(key)) {
        error(
          ctx,
          `${recordPath}.position`,
          "同一容器内不能重复占用单元格",
          "DUPLICATE_POSITION",
        );
      }
      occupied.add(key);
      if (layout && (position[0] >= layout[0] || position[1] >= layout[1])) {
        error(
          ctx,
          `${recordPath}.position`,
          "放置坐标超出父容器 layout 范围",
          "POSITION_OUT_OF_BOUNDS",
        );
      }
    }
    const slot: Slot = {};
    slots.push({ position: position ?? [0, 0], slot });
    visits.push({
      kind: "visit",
      raw: placed.module,
      path: `${recordPath}.module`,
      slot,
    });
  }
  return { slots, visits };
}

/** Business validation is confined to TS; the source document is never edited. */
export function validateRenderDocument(value: unknown): RenderValidationResult {
  const ctx: ValidationContext = { errors: [], warnings: [] };
  const doc = object(value, "$", ctx);
  if (!doc) {
    return { ok: false, errors: ctx.errors, warnings: ctx.warnings };
  }
  enumeration(
    doc["image-create-tool-version"],
    '$["image-create-tool-version"]',
    ctx,
    ["v0.2.0"],
  );
  string(doc.documentId, "$.documentId", ctx);
  integer(doc.revision, "$.revision", ctx, 0);
  unsupportedFields(doc, LEGACY_ASSETS, "$", ctx);
  const composition = object(doc.composition, "$.composition", ctx) ?? {};
  unknownFields(composition, ["width", "height"], "$.composition", ctx);
  const output = {
    width: outputSize(composition.width, "$.composition.width", ctx),
    height: outputSize(composition.height, "$.composition.height", ctx),
  };
  const roots = array(doc.modules, "$.modules", ctx);
  if (roots.length !== 1) {
    error(ctx, "$.modules", "可渲染文档必须且只能包含一个根模块");
  }
  const rootSlots: Slot[] = roots.map(() => ({}));
  const stack: Frame[] = [];
  for (let i = roots.length - 1; i >= 0; i--) {
    stack.push({
      kind: "visit",
      raw: roots[i],
      path: `$.modules[${i}]`,
      slot: rootSlots[i],
    });
  }
  const ids = new Set<string>();
  const active = new WeakSet<object>();
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.kind === "finish") {
      active.delete(frame.raw);
      const nonempty = frame.children.flatMap(({ position, slot }) =>
        slot.value ? [{ position, module: slot.value }] : [],
      );
      if (nonempty.length > 0) {
        frame.slot.value = { ...frame.parent, children: nonempty };
      }
      continue;
    }
    const { path, slot } = frame;
    const fields = object(frame.raw, path, ctx);
    if (!fields) {
      continue;
    }
    const id = string(fields.id, `${path}.id`, ctx);
    const local: ValidationContext = {
      ...ctx,
      ...(id === "" ? {} : { moduleId: id }),
    };
    if (active.has(fields)) {
      error(local, path, "模块不能循环引用父模块", "INVALID_STRUCTURE");
      continue;
    }
    if (id !== "" && ids.has(id)) {
      error(
        local,
        `${path}.id`,
        "模块 ID 在文档内必须唯一",
        "DUPLICATE_MODULE_ID",
      );
    }
    if (id !== "") {
      ids.add(id);
    }
    const layoutPresent = fields.layout !== undefined;
    let type: ModuleType | undefined;
    if (layoutPresent) {
      if (fields.type !== undefined) {
        error(
          local,
          `${path}.type`,
          "布局模块不配置 type；图片、文字等内容请放入最小子模块",
        );
      }
      unsupportedFields(fields, ["text"], path, local);
    } else {
      type = enumeration(fields.type, `${path}.type`, local, MODULE_TYPES);
      if (!MODULE_TYPES.some((candidate) => candidate === fields.type)) {
        continue;
      }
    }
    unsupportedFields(
      fields,
      [...LEGACY_ASSETS, ...UNSUPPORTED_MODULE_FIELDS],
      path,
      local,
    );
    if (type !== "image") {
      unsupportedFields(fields, ["assetPath", "fit"], path, local);
      const calls = resolveProcessors(
        fields.processors,
        `${path}.processors`,
        local,
      );
      if (calls.length > 0) {
        error(local, `${path}.processors`, "只有图片模块支持处理链");
      }
    }
    if (layoutPresent) {
      unsupportedFields(fields, ["width", "height"], path, local);
      const layout = gridPair(fields.layout, `${path}.layout`, local, 1);
      const parent = {
        id,
        path,
        layout: layout ?? ([1, 1] as const),
        padding: integer(
          fields.padding,
          `${path}.padding`,
          local,
          0,
          D.modulePadding,
        ),
        gap: integer(fields.gap, `${path}.gap`, local, 0, D.moduleGap),
        style: resolveModuleStyle(fields.style, type, `${path}.style`, local),
      };
      const { slots, visits } = children(fields, layout, path, local);
      active.add(fields);
      stack.push({
        kind: "finish",
        raw: fields,
        parent,
        children: slots,
        slot,
      });
      for (let i = visits.length - 1; i >= 0; i--) {
        stack.push(visits[i]);
      }
      continue;
    }
    if (array(fields.children, `${path}.children`, local, true).length > 0) {
      error(local, `${path}.children`, "叶子模块不能包含子模块");
    }
    unsupportedFields(fields, ["padding", "gap"], path, local);
    const beforeSize = ctx.errors.length;
    const width = integer(fields.width, `${path}.width`, local, 1);
    const height = integer(fields.height, `${path}.height`, local, 1);
    const validSize = beforeSize === ctx.errors.length;
    if (type === "text") {
      const text = string(fields.text, `${path}.text`, local, true);
      const style = resolveModuleStyle(
        fields.style,
        type,
        `${path}.style`,
        local,
      );
      if (validSize) {
        validateContentBox(width, height, style, path, local);
      }
      if (text.trim().length > 0) {
        slot.value = { id, type, path, width, height, text, style };
      }
    } else if (type === "image") {
      const style = resolveModuleStyle(
        fields.style,
        type,
        `${path}.style`,
        local,
      );
      if (validSize) {
        validateContentBox(width, height, style, path, local);
      }
      slot.value = {
        id,
        type,
        path,
        width,
        height,
        style,
        assetPath: imagePath(fields.assetPath, `${path}.assetPath`, local),
        fit:
          attempt(local, `${path}.fit`, () => resolveImageFit(fields.fit)) ??
          IMAGE_RENDER_DEFAULTS.fit,
        processors: resolveProcessors(
          fields.processors,
          `${path}.processors`,
          local,
        ),
      };
    } else {
      const style = resolveModuleStyle(
        fields.style,
        type,
        `${path}.style`,
        local,
      );
      slot.value = { id, type: "rect", path, width, height, style };
    }
  }
  const root = rootSlots[0]?.value;
  if (ctx.errors.length === 0 && !root) {
    error(ctx, "$.modules[0]", "无可渲染内容", "NO_RENDERABLE_CONTENT");
  }
  if (ctx.errors.length > 0 || !root) {
    return { ok: false, errors: ctx.errors, warnings: ctx.warnings };
  }
  return {
    ok: true,
    input: { composition: output, root },
    warnings: ctx.warnings,
  };
}
