import { createSurface, requirePositive, sourceSize } from "./canvas";
import { ImageProcessingError } from "./errors";
import type { CropRectangle, ImageSource } from "./types";

/** Crop a source rectangle into a new canvas of exactly width × height pixels. */
export function cropRectangle(
  source: ImageSource,
  rectangle: CropRectangle,
): HTMLCanvasElement {
  const size = sourceSize(source);
  const { x, y, width, height } = rectangle;
  if (!Number.isFinite(x) || x < 0 || !Number.isFinite(y) || y < 0) {
    throw new ImageProcessingError(
      "INVALID_IMAGE_ARGUMENT",
      "Crop coordinates must be finite and nonnegative",
    );
  }
  requirePositive(width, "width");
  requirePositive(height, "height");
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new ImageProcessingError(
      "INVALID_IMAGE_ARGUMENT",
      "Crop width and height must be integer pixel counts",
    );
  }
  if (x > size.width - width || y > size.height - height) {
    throw new ImageProcessingError(
      "CROP_OUT_OF_BOUNDS",
      "The crop rectangle must fit inside the source image",
    );
  }
  const { canvas, context } = createSurface(width, height);
  context.drawImage(source, x, y, width, height, 0, 0, width, height);
  return canvas;
}
