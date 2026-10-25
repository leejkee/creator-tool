import type { ImageProcessorErrorCode, ProcessorContext } from "./types";

export class ImageProcessorError extends Error {
  constructor(
    readonly code: ImageProcessorErrorCode,
    message: string,
    readonly context: ProcessorContext = {},
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ImageProcessorError";
  }
}
