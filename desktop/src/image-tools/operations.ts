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
    throw new ImageProcessingError("INVALID_IMAGE_ARGUMENT", "Crop coordinates must be finite and nonnegative");
  }
  requirePositive(width, "width");
  requirePositive(height, "height");
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new ImageProcessingError("INVALID_IMAGE_ARGUMENT", "Crop width and height must be integer pixel counts");
  }
  if (x > size.width - width || y > size.height - height) {
    throw new ImageProcessingError("CROP_OUT_OF_BOUNDS", "The crop rectangle must fit inside the source image");
  }
  const { canvas, context } = createSurface(width, height);
  context.drawImage(source, x, y, width, height, 0, 0, width, height);
  return canvas;
}

/**
 * Crop a circle centered on the original image, preserving transparency outside it.
 * Fractional radii are accepted; the square output side is ceil(2 × radius).
 */
export function cropCircle(source: ImageSource, radius: number): HTMLCanvasElement {
  const size = sourceSize(source);
  requirePositive(radius, "radius");
  if (radius > Math.min(size.width, size.height) / 2) {
    throw new ImageProcessingError("CROP_OUT_OF_BOUNDS", "The centered circle must fit inside the source image");
  }
  const side = Math.ceil(2 * radius);
  const { canvas, context } = createSurface(side, side);
  const center = side / 2;
  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, 2 * Math.PI);
  context.clip();
  // Translation alone: the source center maps to the output center, with no resizing.
  context.drawImage(source, center - size.width / 2, center - size.height / 2);
  context.restore();
  context.beginPath();
  return canvas;
}

/** Uniform scaling; ratio 1 copies, below 1 shrinks, above 1 enlarges. */
export function scaleImage(source: ImageSource, ratio: number): HTMLCanvasElement {
  const size = sourceSize(source);
  requirePositive(ratio, "ratio");
  const width = Math.max(1, Math.round(size.width * ratio));
  const height = Math.max(1, Math.round(size.height * ratio));
  const { canvas, context } = createSurface(width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, size.width, size.height, 0, 0, width, height);
  return canvas;
}
