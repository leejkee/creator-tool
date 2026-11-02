import { createSurface, requireCircleWithinSource, sourceSize } from "./canvas";
import { ImageProcessingError } from "./errors";
import type { BlurOptions, ImageSource } from "./types";

/** Extend edge pixels so opaque source borders do not fade into transparency. */
function paddedSource(
  source: ImageSource,
  width: number,
  height: number,
  padding: number,
): HTMLCanvasElement {
  const surface = createSurface(width + 2 * padding, height + 2 * padding);
  const { context } = surface;
  context.imageSmoothingEnabled = false;
  context.drawImage(source, padding, padding);
  // Left, right, top and bottom strips.
  context.drawImage(source, 0, 0, 1, height, 0, padding, padding, height);
  context.drawImage(
    source,
    width - 1,
    0,
    1,
    height,
    padding + width,
    padding,
    padding,
    height,
  );
  context.drawImage(source, 0, 0, width, 1, padding, 0, width, padding);
  context.drawImage(
    source,
    0,
    height - 1,
    width,
    1,
    padding,
    padding + height,
    width,
    padding,
  );
  // Four corner pixels.
  context.drawImage(source, 0, 0, 1, 1, 0, 0, padding, padding);
  context.drawImage(
    source,
    width - 1,
    0,
    1,
    1,
    padding + width,
    0,
    padding,
    padding,
  );
  context.drawImage(
    source,
    0,
    height - 1,
    1,
    1,
    0,
    padding + height,
    padding,
    padding,
  );
  context.drawImage(
    source,
    width - 1,
    height - 1,
    1,
    1,
    padding + width,
    padding + height,
    padding,
    padding,
  );
  return surface.canvas;
}

/**
 * Blur the whole image, optionally restoring a clear circle from the original.
 * Output dimensions are unchanged. No tint, opacity or noise is added.
 */
export function blurImage(
  source: ImageSource,
  options: BlurOptions,
): HTMLCanvasElement {
  const size = sourceSize(source);
  if (options === null || typeof options !== "object") {
    throw new ImageProcessingError(
      "INVALID_IMAGE_ARGUMENT",
      "Blur options are required",
    );
  }
  const { blurRadius, clearCircle } = options;
  if (!Number.isFinite(blurRadius) || blurRadius < 0) {
    throw new ImageProcessingError(
      "INVALID_IMAGE_ARGUMENT",
      "blurRadius must be finite and nonnegative",
    );
  }
  if (clearCircle !== undefined) {
    requireCircleWithinSource(clearCircle, size);
  }
  const { canvas, context } = createSurface(size.width, size.height);
  if (blurRadius === 0) {
    context.drawImage(source, 0, 0);
    return canvas;
  }
  if (typeof context.filter !== "string") {
    throw new ImageProcessingError(
      "FILTER_UNAVAILABLE",
      "Canvas 2D filters are not supported in this environment",
    );
  }
  // Validate and allocate the padded surface before passing the radius to CSS.
  const padding = Math.ceil(3 * blurRadius);
  const padded = paddedSource(source, size.width, size.height, padding);
  context.save();
  context.filter = `blur(${blurRadius}px)`;
  if (context.filter === "none") {
    throw new ImageProcessingError(
      "FILTER_UNAVAILABLE",
      "Cannot apply the requested Canvas blur filter",
    );
  }
  context.drawImage(padded, -padding, -padding);
  context.restore();
  if (clearCircle !== undefined) {
    const { centerX, centerY, radius } = clearCircle;
    context.save();
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    context.clip();
    // Clear before restoring: transparent original pixels must not show blurred pixels below.
    context.clearRect(0, 0, size.width, size.height);
    // Add premultiplied source coverage to the remaining blurred coverage.
    // Source-over here would apply the antialiased mask twice and leave an alpha seam.
    context.globalCompositeOperation = "lighter";
    context.drawImage(source, 0, 0);
    context.restore();
    context.beginPath();
  }
  return canvas;
}
