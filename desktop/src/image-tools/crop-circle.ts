import { createSurface, requireCircleWithinSource, sourceSize } from "./canvas";
import type { CropCircle, ImageSource } from "./types";

/**
 * Crop a circle at the specified source-image center, preserving transparency outside it.
 * Fractional radii are accepted; the square output side is ceil(2 × radius).
 */
export function cropCircle(source: ImageSource, circle: CropCircle): HTMLCanvasElement {
  const size = sourceSize(source);
  requireCircleWithinSource(circle, size);
  const { centerX, centerY, radius } = circle;
  const side = Math.ceil(2 * radius);
  const { canvas, context } = createSurface(side, side);
  const center = side / 2;
  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, 2 * Math.PI);
  context.clip();
  // Translation alone: the chosen source center maps to the output center.
  context.drawImage(source, center - centerX, center - centerY);
  context.restore();
  context.beginPath();
  return canvas;
}
