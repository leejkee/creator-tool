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

/** Resolve defaults without validation or changing the source document. */
export function resolveImageRenderInput(module: ImageModule): ImageRenderInput {
  return {
    fit: module.fit === undefined ? IMAGE_RENDER_DEFAULTS.fit : module.fit,
  };
}
