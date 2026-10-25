/** Decoded raster sources accepted by Canvas drawImage; no loading or file I/O. */
export type ImageSource =
  | HTMLImageElement
  | HTMLCanvasElement
  | ImageBitmap
  | OffscreenCanvas;

export interface CropRectangle {
  /** Source-image coordinates. Fractional offsets are supported. */
  readonly x: number;
  readonly y: number;
  /** Output pixel counts must be positive integers. */
  readonly width: number;
  readonly height: number;
}

export type ImageProcessingErrorCode =
  | "INVALID_IMAGE_SOURCE"
  | "INVALID_IMAGE_ARGUMENT"
  | "CROP_OUT_OF_BOUNDS"
  | "INVALID_OUTPUT_SIZE"
  | "CANVAS_UNAVAILABLE";
