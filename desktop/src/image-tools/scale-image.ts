import { createSurface, requirePositive, sourceSize } from "./canvas";
import type { ImageSource } from "./types";

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
