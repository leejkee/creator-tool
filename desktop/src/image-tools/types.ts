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

export interface CropCircle {
  /** Center in source-image pixels; fractional coordinates are supported. */
  readonly centerX: number;
  readonly centerY: number;
  readonly radius: number;
}

export interface BlurOptions {
  /** Gaussian blur strength in pixels; zero returns an independent copy. */
  readonly blurRadius: number;
  /** Omit to blur everything; otherwise retain this original-image region. */
  readonly clearCircle?: CropCircle;
}

export type ImageProcessingErrorCode =
  | "INVALID_IMAGE_SOURCE"
  | "INVALID_IMAGE_ARGUMENT"
  | "CROP_OUT_OF_BOUNDS"
  | "INVALID_OUTPUT_SIZE"
  | "CANVAS_UNAVAILABLE"
  | "FILTER_UNAVAILABLE";
