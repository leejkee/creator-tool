import { ImageProcessingError } from "./errors";
import type { CropCircle, ImageSource } from "./types";

export function requirePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ImageProcessingError(
      "INVALID_IMAGE_ARGUMENT",
      `${name} must be a finite number greater than zero`,
    );
  }
}

export function sourceSize(source: ImageSource): {
  width: number;
  height: number;
} {
  // HTMLImageElement.width/height may be CSS dimensions. Use decoded image pixels.
  const width = "naturalWidth" in source ? source.naturalWidth : source.width;
  const height =
    "naturalHeight" in source ? source.naturalHeight : source.height;
  if (
    ("complete" in source && !source.complete) ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0
  ) {
    throw new ImageProcessingError(
      "INVALID_IMAGE_SOURCE",
      "The source must be a decoded, nonempty raster image",
    );
  }
  return { width, height };
}

export function createSurface(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  // HTML canvas dimensions are unsigned 32-bit integers. Actual engine limits may be lower.
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    width > 0xffffffff ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    height > 0xffffffff ||
    !Number.isSafeInteger(width * height)
  ) {
    throw new ImageProcessingError(
      "INVALID_OUTPUT_SIZE",
      "Output dimensions are not supported",
    );
  }
  if (typeof document === "undefined") {
    throw new ImageProcessingError(
      "CANVAS_UNAVAILABLE",
      "A Web Canvas environment is required",
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (
    !context ||
    canvas.width !== width ||
    canvas.height !== height ||
    (typeof context.isContextLost === "function" && context.isContextLost())
  ) {
    throw new ImageProcessingError(
      "CANVAS_UNAVAILABLE",
      "Cannot create the output Canvas 2D context",
    );
  }
  return { canvas, context };
}

/** Shared circle geometry for cropping and selective blur. */
export function requireCircleWithinSource(
  circle: CropCircle,
  size: { readonly width: number; readonly height: number },
): void {
  if (circle === null || typeof circle !== "object") {
    throw new ImageProcessingError(
      "INVALID_IMAGE_ARGUMENT",
      "Circle center and radius are required",
    );
  }
  const { centerX, centerY, radius } = circle;
  if (
    !Number.isFinite(centerX) ||
    centerX < 0 ||
    !Number.isFinite(centerY) ||
    centerY < 0
  ) {
    throw new ImageProcessingError(
      "INVALID_IMAGE_ARGUMENT",
      "Circle center coordinates must be finite and nonnegative",
    );
  }
  requirePositive(radius, "radius");
  if (
    radius > centerX ||
    radius > centerY ||
    radius > size.width - centerX ||
    radius > size.height - centerY
  ) {
    throw new ImageProcessingError(
      "CROP_OUT_OF_BOUNDS",
      "The whole circle must fit inside the source image",
    );
  }
}
