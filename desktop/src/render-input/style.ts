import type { HorizontalAlign, ModuleType } from "../types";
import { resolveLocalImagePath } from "./asset";
import { RENDER_DEFAULTS as D } from "./defaults";
import { resolveFontFamily } from "./font";
import { resolveImageFit } from "./image";
import type {
  RenderBackground,
  RenderBorder,
  RenderContentStyle,
  RenderStyle,
  RenderTextStyle,
} from "./types";
import {
  attempt,
  boolean,
  color,
  enumeration,
  error,
  integer,
  object,
  unknownFields,
  warn,
} from "./validation";
import type { Fields, ValidationContext } from "./validation";

const COMMON_KEYS = ["radius", "opacity", "border", "background"];
const CONTENT_KEYS = ["align", "verticalAlign", "padding"];
const TEXT_KEYS = [
  "fontSize",
  "color",
  "bold",
  "lineHeight",
  "wrap",
  "fontFamily",
];

/** No filesystem access; missing paths are resolved to the warning asset by Engine. */
export function imagePath(
  value: unknown,
  path: string,
  ctx: ValidationContext,
): string | undefined {
  const errorCount = ctx.errors.length;
  const result = attempt(ctx, path, () => resolveLocalImagePath(value));
  if (result === undefined && errorCount === ctx.errors.length) {
    warn(
      ctx,
      path,
      "未选择本地图片，渲染时使用警告占位图",
      "MISSING_IMAGE_SOURCE",
    );
  }
  return result;
}

function background(
  value: unknown,
  path: string,
  ctx: ValidationContext,
): RenderBackground | undefined {
  const fields = object(value, path, ctx, true);
  if (!fields) {
    return undefined;
  }
  const type = enumeration(fields.type, `${path}.type`, ctx, [
    "color",
    "image",
  ]);
  if (type === "color") {
    unknownFields(fields, ["type", "color"], path, ctx);
    return { type, color: color(fields.color, `${path}.color`, ctx) };
  }
  unknownFields(
    fields,
    ["type", "assetPath", "fit", "align", "verticalAlign"],
    path,
    ctx,
  );
  return {
    type,
    assetPath: imagePath(fields.assetPath, `${path}.assetPath`, ctx),
    fit:
      attempt(ctx, `${path}.fit`, () =>
        resolveImageFit(fields.fit, D.backgroundFit),
      ) ?? D.backgroundFit,
    align: enumeration(
      fields.align,
      `${path}.align`,
      ctx,
      ["left", "center", "right"],
      D.imageAlign,
    ),
    verticalAlign: enumeration(
      fields.verticalAlign,
      `${path}.verticalAlign`,
      ctx,
      ["top", "center", "bottom"],
      D.verticalAlign,
    ),
  };
}

function border(
  value: unknown,
  path: string,
  ctx: ValidationContext,
): RenderBorder | undefined {
  const fields = object(value, path, ctx, true);
  if (!fields) {
    return undefined;
  }
  unknownFields(fields, ["width", "color"], path, ctx);
  return {
    width: integer(fields.width, `${path}.width`, ctx, 0, D.borderWidth),
    color: color(fields.color, `${path}.color`, ctx, D.borderColor),
  };
}

function appearance(
  fields: Fields,
  path: string,
  ctx: ValidationContext,
): RenderStyle {
  const opacity = fields.opacity === undefined ? D.opacity : fields.opacity;
  if (
    typeof opacity !== "number" ||
    !Number.isFinite(opacity) ||
    opacity < 0 ||
    opacity > 1
  ) {
    error(ctx, `${path}.opacity`, "必须是 0～1 的有限数值");
  }
  return {
    radius: integer(fields.radius, `${path}.radius`, ctx, 0, D.radius),
    opacity: typeof opacity === "number" ? opacity : D.opacity,
    border: border(fields.border, `${path}.border`, ctx),
    background: background(fields.background, `${path}.background`, ctx),
  };
}

export function resolveModuleStyle(
  value: unknown,
  type: "text",
  path: string,
  ctx: ValidationContext,
): RenderTextStyle;
export function resolveModuleStyle(
  value: unknown,
  type: "image",
  path: string,
  ctx: ValidationContext,
): RenderContentStyle;
export function resolveModuleStyle(
  value: unknown,
  type: ModuleType | undefined,
  path: string,
  ctx: ValidationContext,
): RenderStyle;
export function resolveModuleStyle(
  value: unknown,
  type: ModuleType | undefined,
  path: string,
  ctx: ValidationContext,
): RenderStyle | RenderContentStyle | RenderTextStyle {
  const fields = object(value, path, ctx, true) ?? {};
  const hasContent = type === "text" || type === "image";
  unknownFields(
    fields,
    [
      ...COMMON_KEYS,
      ...(hasContent ? CONTENT_KEYS : []),
      ...(type === "text" ? TEXT_KEYS : []),
    ],
    path,
    ctx,
  );
  const common = appearance(fields, path, ctx);
  if (!hasContent) {
    return common;
  }
  const align: HorizontalAlign = type === "text" ? D.textAlign : D.imageAlign;
  const content: RenderContentStyle = {
    ...common,
    align: enumeration(
      fields.align,
      `${path}.align`,
      ctx,
      ["left", "center", "right"],
      align,
    ),
    verticalAlign: enumeration(
      fields.verticalAlign,
      `${path}.verticalAlign`,
      ctx,
      ["top", "center", "bottom"],
      D.verticalAlign,
    ),
    padding: integer(
      fields.padding,
      `${path}.padding`,
      ctx,
      0,
      D.contentPadding,
    ),
  };
  if (type !== "text") {
    return content;
  }
  const fontSize = integer(
    fields.fontSize,
    `${path}.fontSize`,
    ctx,
    1,
    D.fontSize,
  );
  const lineHeight =
    fields.lineHeight === undefined
      ? Math.round(fontSize * D.lineHeightRatio * 10) / 10
      : integer(fields.lineHeight, `${path}.lineHeight`, ctx, 1);
  return {
    ...content,
    fontSize,
    lineHeight,
    color: color(fields.color, `${path}.color`, ctx, D.textColor),
    bold: boolean(fields.bold, `${path}.bold`, ctx, D.bold),
    wrap: boolean(fields.wrap, `${path}.wrap`, ctx, D.wrap),
    fontFamily:
      attempt(ctx, `${path}.fontFamily`, () =>
        resolveFontFamily(fields.fontFamily),
      ) ?? resolveFontFamily(),
  };
}

export function validateContentBox(
  width: number,
  height: number,
  style: RenderContentStyle,
  path: string,
  ctx: ValidationContext,
): void {
  const inset = style.padding + (style.border?.width ?? 0);
  if (width - 2 * inset <= 0 || height - 2 * inset <= 0) {
    error(
      ctx,
      `${path}.style.padding`,
      "扣除内边距和边框后的内容宽高必须大于 0，请调整模块尺寸、内边距或边框",
    );
  }
}
