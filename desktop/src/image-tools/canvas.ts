import { ImageProcessingError } from "./errors";
import type { ImageSource } from "./types";

export function requirePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ImageProcessingError(
      "INVALID_IMAGE_ARGUMENT",
      `${name} must be a finite number greater than zero`,
    );
  }
}

export function sourceSize(source: ImageSource): { width: number; height: number } {
  // HTMLImageElement.width/height may be CSS dimensions. Use decoded image pixels.
  const width = "naturalWidth" in source ? source.naturalWidth : source.width;
  const height = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (
    ("complete" in source && !source.complete) ||
    !Number.isSafeInteger(width) || width <= 0 ||
    !Number.isSafeInteger(height) || height <= 0
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
    !Number.isSafeInteger(width) || width <= 0 || width > 0xffffffff ||
    !Number.isSafeInteger(height) || height <= 0 || height > 0xffffffff ||
    !Number.isSafeInteger(width * height)
  ) {
    throw new ImageProcessingError("INVALID_OUTPUT_SIZE", "Output dimensions are not supported");
  }
  if (typeof document === "undefined") {
    throw new ImageProcessingError("CANVAS_UNAVAILABLE", "A Web Canvas environment is required");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context || canvas.width !== width || canvas.height !== height || (typeof context.isContextLost === "function" && context.isContextLost())) {
    throw new ImageProcessingError("CANVAS_UNAVAILABLE", "Cannot create the output Canvas 2D context");
  }
  return { canvas, context };
}
