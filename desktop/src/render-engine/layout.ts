import type {
  DocumentRenderInput,
  RenderGroupModule,
  RenderModule,
} from "../render-input";
import { failure } from "./control";
import type { EngineIssue, ModuleLayout, PixelBox, PixelSize } from "./types";

interface Track {
  readonly index: number;
  readonly size: number;
}

interface Measured {
  readonly module: RenderModule;
  readonly width: number;
  readonly height: number;
  readonly columns: readonly Track[];
  readonly rows: readonly Track[];
  readonly contentWidth: number;
  readonly contentHeight: number;
}

export interface LayoutNode extends ModuleLayout {
  readonly module: RenderModule;
  readonly children: LayoutNode[];
}

export interface LayoutResult extends PixelSize {
  readonly root: LayoutNode;
  readonly modules: readonly LayoutNode[];
  readonly naturalSize: PixelSize;
  readonly scale: number;
  readonly warnings: readonly EngineIssue[];
}

export function pixel(value: number): number {
  // Multiplying a large safe value by ten must not destroy its integer precision.
  return Math.abs(value) >= Number.MAX_SAFE_INTEGER / 10
    ? value
    : Math.round(value * 10) / 10;
}

function sum(values: readonly number[], module: RenderModule): number {
  let result = 0;
  for (const value of values) {
    result += value;
    if (!Number.isSafeInteger(result) || result < 0) {
      throw failure("LAYOUT_OVERFLOW", "自然布局尺寸超出可精确表示范围", {
        moduleId: module.id,
        path: module.path,
      });
    }
  }
  return result;
}

function tracks(values: Map<number, number>): Track[] {
  return Array.from(values, ([index, size]) => ({ index, size })).sort(
    (a, b) => a.index - b.index,
  );
}

function measure(root: RenderModule): Map<RenderModule, Measured> {
  const measured = new Map<RenderModule, Measured>();
  const stack: { module: RenderModule; finish?: boolean }[] = [
    { module: root },
  ];
  while (stack.length > 0) {
    const { module, finish } = stack.pop()!;
    if (module.type !== "group") {
      measured.set(module, {
        module,
        width: module.width,
        height: module.height,
        columns: [],
        rows: [],
        contentWidth: module.width,
        contentHeight: module.height,
      });
      continue;
    }
    if (!finish) {
      stack.push({ module, finish: true });
      for (const child of module.children) {
        stack.push({ module: child.module });
      }
      continue;
    }
    // Only occupied tracks are materialized, even when layout declares billions of cells.
    const columnSizes = new Map<number, number>();
    const rowSizes = new Map<number, number>();
    for (const child of module.children) {
      const size = measured.get(child.module)!;
      const [row, column] = child.position;
      columnSizes.set(
        column,
        Math.max(columnSizes.get(column) ?? 0, size.width),
      );
      rowSizes.set(row, Math.max(rowSizes.get(row) ?? 0, size.height));
    }
    const columns = tracks(columnSizes);
    const rows = tracks(rowSizes);
    const contentWidth = sum(
      columns.map((track) => track.size),
      module,
    );
    const contentHeight = sum(
      rows.map((track) => track.size),
      module,
    );
    const border = module.style.border?.width ?? 0;
    const width = sum(
      [
        contentWidth,
        (columns.length - 1) * module.gap,
        2 * module.padding,
        2 * border,
      ],
      module,
    );
    const height = sum(
      [
        contentHeight,
        (rows.length - 1) * module.gap,
        2 * module.padding,
        2 * border,
      ],
      module,
    );
    measured.set(module, {
      module,
      width,
      height,
      columns,
      rows,
      contentWidth,
      contentHeight,
    });
  }
  return measured;
}

function spacing(
  module: RenderGroupModule,
  content: number,
  count: number,
  size: number,
  scale: number,
  constrained: boolean,
): { padding: number; gap: number } {
  if (!constrained) {
    return { padding: module.padding * scale, gap: module.gap * scale };
  }
  const available = Math.max(
    0,
    size - scale * (content + 2 * (module.style.border?.width ?? 0)),
  );
  const proportions = 2 * module.padding + (count - 1) * module.gap;
  if (proportions === 0) {
    return { padding: available / 2, gap: 0 };
  }
  return {
    padding: available * (module.padding / proportions),
    gap: available * (module.gap / proportions),
  };
}

function positions(
  tracks: readonly Track[],
  start: number,
  gap: number,
  scale: number,
): Map<number, number> {
  const result = new Map<number, number>();
  let offset = start;
  for (const track of tracks) {
    result.set(track.index, offset);
    offset += track.size * scale + gap;
  }
  return result;
}

function roundedBox(
  x: number,
  y: number,
  width: number,
  height: number,
): PixelBox {
  return Object.freeze({
    x: pixel(x),
    y: pixel(y),
    width: Math.max(0, pixel(width)),
    height: Math.max(0, pixel(height)),
  });
}

/** Pure geometry. Text and images never feed intrinsic dimensions back into the grid. */
export function computeLayout(input: DocumentRenderInput): LayoutResult {
  const measured = measure(input.root);
  const natural = measured.get(input.root)!;
  const fixedWidth =
    input.composition.width === "auto" ? undefined : input.composition.width;
  const fixedHeight =
    input.composition.height === "auto" ? undefined : input.composition.height;
  const border = input.root.style.border?.width ?? 0;
  const minimumWidth =
    input.root.type === "group"
      ? natural.contentWidth + 2 * border
      : natural.width;
  const minimumHeight =
    input.root.type === "group"
      ? natural.contentHeight + 2 * border
      : natural.height;
  const scale = Math.min(
    1,
    fixedWidth === undefined ? 1 : fixedWidth / minimumWidth,
    fixedHeight === undefined ? 1 : fixedHeight / minimumHeight,
  );
  const rootWidth =
    input.root.type === "group" && fixedWidth !== undefined
      ? fixedWidth
      : natural.width * scale;
  const rootHeight =
    input.root.type === "group" && fixedHeight !== undefined
      ? fixedHeight
      : natural.height * scale;
  const width = fixedWidth ?? Math.ceil(rootWidth);
  const height = fixedHeight ?? Math.ceil(rootHeight);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw failure("LAYOUT_OVERFLOW", "最终输出尺寸无法表示", {
      path: "$.composition",
    });
  }

  type Visit = {
    module: RenderModule;
    x: number;
    y: number;
    parent?: LayoutNode;
  };
  const pending: Visit[] = [
    {
      module: input.root,
      x: fixedWidth === undefined ? 0 : (width - rootWidth) / 2,
      y: fixedHeight === undefined ? 0 : (height - rootHeight) / 2,
    },
  ];
  const nodes: LayoutNode[] = [];
  while (pending.length > 0) {
    const visit = pending.pop()!;
    const { module, x, y, parent } = visit;
    const size = measured.get(module)!;
    const isRoot = module === input.root;
    const outerWidth = isRoot ? rootWidth : size.width * scale;
    const outerHeight = isRoot ? rootHeight : size.height * scale;
    const box = roundedBox(x, y, outerWidth, outerHeight);
    const rawBorder = (module.style.border?.width ?? 0) * scale;
    let paddingX = 0;
    let paddingY = 0;
    let gapX = 0;
    let gapY = 0;
    let contentBox: PixelBox | undefined;
    if (module.type === "group") {
      const horizontal = spacing(
        module,
        size.contentWidth,
        size.columns.length,
        outerWidth,
        scale,
        isRoot && fixedWidth !== undefined,
      );
      const vertical = spacing(
        module,
        size.contentHeight,
        size.rows.length,
        outerHeight,
        scale,
        isRoot && fixedHeight !== undefined,
      );
      paddingX = horizontal.padding;
      paddingY = vertical.padding;
      gapX = horizontal.gap;
      gapY = vertical.gap;
    } else if (module.type === "text" || module.type === "image") {
      paddingX = module.style.padding * scale;
      paddingY = paddingX;
      contentBox = roundedBox(
        x + rawBorder + paddingX,
        y + rawBorder + paddingY,
        outerWidth - 2 * (rawBorder + paddingX),
        outerHeight - 2 * (rawBorder + paddingY),
      );
    }
    const radiusLimit = Math.floor(Math.min(box.width, box.height) * 5) / 10;
    const node: LayoutNode = {
      module,
      moduleId: module.id,
      type: module.type,
      path: module.path,
      box,
      contentBox,
      borderWidth: pixel(rawBorder),
      radius: Math.min(pixel(module.style.radius * scale), radiusLimit),
      paddingX: pixel(paddingX),
      paddingY: pixel(paddingY),
      gapX: pixel(gapX),
      gapY: pixel(gapY),
      children: [],
    };
    parent?.children.push(node);
    nodes.push(node);
    if (module.type === "group") {
      const columnOffsets = positions(
        size.columns,
        x + rawBorder + paddingX,
        gapX,
        scale,
      );
      const rowOffsets = positions(
        size.rows,
        y + rawBorder + paddingY,
        gapY,
        scale,
      );
      const columns = new Map(
        size.columns.map((track) => [track.index, track.size]),
      );
      const rows = new Map(size.rows.map((track) => [track.index, track.size]));
      const children = [...module.children].sort(
        (a, b) =>
          a.position[0] - b.position[0] || a.position[1] - b.position[1],
      );
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        const childSize = measured.get(child.module)!;
        const [row, column] = child.position;
        pending.push({
          module: child.module,
          parent: node,
          x:
            columnOffsets.get(column)! +
            ((columns.get(column)! - childSize.width) * scale) / 2,
          y:
            rowOffsets.get(row)! +
            ((rows.get(row)! - childSize.height) * scale) / 2,
        });
      }
    }
  }
  const warnings: EngineIssue[] =
    scale < 1
      ? [
          {
            code: "OUTPUT_SCALED",
            path: "$.composition",
            moduleId: input.root.id,
            message: `输出尺寸不足，模块统一缩小至 ${(scale * 100).toPrecision(5)}%，请增大输出尺寸或减小模块尺寸`,
            details: {
              naturalSize: { width: natural.width, height: natural.height },
              outputSize: { width, height },
              scale,
              affectedModuleIds: nodes.map((node) => node.moduleId),
            },
          },
        ]
      : [];
  return {
    root: nodes[0],
    modules: nodes,
    naturalSize: { width: natural.width, height: natural.height },
    width,
    height,
    scale,
    warnings,
  };
}
