import type { ImageFit, ImageModule } from "../types";

/** Resolved image parameters consumed by rendering, separate from the saved DTO. */
export interface ImageRenderInput {
  readonly fit: ImageFit;
}

export const IMAGE_RENDER_DEFAULTS = {
  // 默认等比完整显示：例如 400×200 的原图放入 200×200 区域时，显示为 200×100。
  // 不裁剪、不变形；空余区域显示背景或保持透明，对齐位置由布局层决定。
  fit: "contain",
} as const satisfies ImageRenderInput;

export function resolveImageFit(
  fit: unknown = undefined,
  fallback: ImageFit = IMAGE_RENDER_DEFAULTS.fit,
): ImageFit {
  if (fit === undefined) {
    return fallback;
  }
  if (
    fit === "contain" ||
    fit === "cover" ||
    fit === "stretch" ||
    fit === "height" ||
    fit === "width"
  ) {
    return fit;
  }
  throw new TypeError("fit must be contain, cover, stretch, height, or width");
}

/** Validate fit and resolve its default without changing the source document. */
export function resolveImageRenderInput(
  module: Pick<ImageModule, "fit"> & { readonly [key: string]: unknown },
): ImageRenderInput {
  return {
    fit: resolveImageFit(module.fit),
  };
}
