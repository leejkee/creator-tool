import { failure } from "./control";

export function createSurface(
  width: number,
  height: number,
): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    width > 0xffffffff ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    height > 0xffffffff ||
    !Number.isSafeInteger(width * height)
  ) {
    throw failure(
      "OUTPUT_UNAVAILABLE",
      `无法创建 ${width}×${height} 的绘制目标`,
    );
  }
  if (typeof document === "undefined") {
    throw failure(
      "CANVAS_UNAVAILABLE",
      "渲染需要 WebView 的 document 和 Canvas 2D 能力",
    );
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!context || canvas.width !== width || canvas.height !== height) {
      throw new Error("绘制目标尺寸或上下文不可用");
    }
    if (context.getContextAttributes().colorSpace !== "srgb") {
      throw new Error("绘制目标不支持 sRGB");
    }
    assertSurface(context);
    context.getImageData(width - 1, height - 1, 1, 1);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    return { canvas, context };
  } catch (error) {
    throw failure(
      "CANVAS_UNAVAILABLE",
      `无法分配 ${width}×${height} 的 sRGB Canvas`,
      {},
      error,
    );
  }
}

export function assertSurface(context: CanvasRenderingContext2D): void {
  if (context.isContextLost()) {
    throw failure("CANVAS_UNAVAILABLE", "Canvas 绘制上下文已丢失");
  }
}
