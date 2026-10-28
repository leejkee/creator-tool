import type { ImageSource } from "../image-tools";
import type { JsonValue } from "../types";

export type ImageProcessorFunction = (
  source: ImageSource,
  ...args: readonly JsonValue[]
) => ImageSource | Promise<ImageSource>;

export type ProcessorRegistration = readonly [
  functionId: string,
  handler: ImageProcessorFunction,
];

/** Construct once from trusted TS imports; resolving never changes the registry. */
export interface ProcessorRegistry {
  readonly resolve: (functionId: string) => ImageProcessorFunction;
}

export interface ProcessorContext {
  readonly functionId?: string;
  /** Zero-based index in the JSON processors array. */
  readonly stepIndex?: number;
}

export type ImageProcessorErrorCode =
  | "INVALID_PROCESSOR_REGISTRATION"
  | "DUPLICATE_PROCESSOR_FUNCTION"
  | "INVALID_PROCESSOR_DECLARATION"
  | "PROCESSOR_FUNCTION_NOT_FOUND"
  | "PROCESSOR_EXECUTION_FAILED"
  | "INVALID_PROCESSOR_OUTPUT";
