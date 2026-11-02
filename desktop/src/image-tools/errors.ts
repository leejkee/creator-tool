import type { ImageProcessingErrorCode } from "./types";

export class ImageProcessingError extends Error {
  constructor(
    readonly code: ImageProcessingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImageProcessingError";
  }
}
