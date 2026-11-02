import { cropRectangle } from "../image-tools";
import { sourceSize } from "../image-tools/canvas";
import type { ImageSource } from "../image-tools";
import type { ImageProcessor, JsonValue } from "../types";
import { ImageProcessorError } from "./errors";
import type { ProcessorContext, ProcessorRegistry } from "./types";

function isImageSource(value: unknown): value is ImageSource {
  return (
    (typeof HTMLCanvasElement !== "undefined" &&
      value instanceof HTMLCanvasElement) ||
    (typeof HTMLImageElement !== "undefined" &&
      value instanceof HTMLImageElement) ||
    (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas)
  );
}

/** Resolve the whole chain first; then run sequentially, awaiting each output. */
export async function runImageProcessors(
  source: ImageSource,
  processors: readonly ImageProcessor[],
  registry: ProcessorRegistry,
): Promise<ImageSource> {
  if (!Array.isArray(processors)) {
    throw new ImageProcessorError(
      "INVALID_PROCESSOR_DECLARATION",
      "processors must be an array",
    );
  }
  const plan = Array.from(processors, (step, stepIndex) => {
    const context: ProcessorContext = { stepIndex };
    if (
      !Array.isArray(step) ||
      typeof step[0] !== "string" ||
      step[0].trim() === ""
    ) {
      throw new ImageProcessorError(
        "INVALID_PROCESSOR_DECLARATION",
        "Expected [function identifier, ...arguments]",
        context,
      );
    }
    const [functionId, ...arguments_] = step;
    const location: ProcessorContext = { stepIndex, functionId };
    try {
      // Snapshot both the selected function and arguments before awaiting any script.
      const handler = registry.resolve(functionId);
      const args: JsonValue[] = structuredClone(arguments_);
      return { handler, args, context: location };
    } catch (error) {
      if (error instanceof ImageProcessorError) {
        throw new ImageProcessorError(
          error.code,
          error.message,
          location,
          error,
        );
      }
      throw new ImageProcessorError(
        "INVALID_PROCESSOR_DECLARATION",
        "Cannot prepare processor arguments",
        location,
        error,
      );
    }
  });
  // Scripts receive an independent raster, so in-place edits cannot change the caller's source.
  const { width, height } = sourceSize(source);
  let current: ImageSource = cropRectangle(source, {
    x: 0,
    y: 0,
    width,
    height,
  });
  for (const { handler, args, context } of plan) {
    let output: unknown;
    try {
      output = await handler(current, ...args);
    } catch (error) {
      throw new ImageProcessorError(
        "PROCESSOR_EXECUTION_FAILED",
        "Image processor failed",
        context,
        error,
      );
    }
    try {
      if (!isImageSource(output)) {
        throw new TypeError("Expected a Canvas-compatible raster image");
      }
      sourceSize(output);
    } catch (error) {
      throw new ImageProcessorError(
        "INVALID_PROCESSOR_OUTPUT",
        "Processor returned an invalid or empty image",
        context,
        error,
      );
    }
    current = output;
  }
  return current;
}
