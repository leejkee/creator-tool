import { blurImage, cropRectangle, ImageProcessingError } from "../../desktop/src/image-tools";
import { sourceSize } from "../../desktop/src/image-tools/canvas";
import type { ImageSource } from "../../desktop/src/image-tools";
import type { JsonValue } from "../../desktop/src/types";

/** Registry entry: square-focus.process(image, blurRadius = 12, clearRadiusRatio = 0.5). */
export function process(source: ImageSource, ...args: readonly JsonValue[]): HTMLCanvasElement {
  if (args.length > 2) {
    throw new ImageProcessingError("INVALID_IMAGE_ARGUMENT", "Expected at most blurRadius and clearRadiusRatio");
  }
  const [blurRadius = 12, clearRadiusRatio = 0.5] = args;
  if (typeof blurRadius !== "number" || !Number.isFinite(blurRadius) || blurRadius < 0) {
    throw new ImageProcessingError("INVALID_IMAGE_ARGUMENT", "blurRadius must be finite and nonnegative");
  }
  if (
    typeof clearRadiusRatio !== "number" || !Number.isFinite(clearRadiusRatio) ||
    clearRadiusRatio <= 0 || clearRadiusRatio > 0.5
  ) {
    throw new ImageProcessingError("INVALID_IMAGE_ARGUMENT", "clearRadiusRatio must be greater than zero and at most 0.5");
  }
  const { width, height } = sourceSize(source);
  const side = Math.min(width, height);
  const square = cropRectangle(source, {
    x: (width - side) / 2,
    y: (height - side) / 2,
    width: side,
    height: side,
  });
  return blurImage(square, {
    blurRadius,
    clearCircle: { centerX: side / 2, centerY: side / 2, radius: side * clearRadiusRatio },
  });
}
