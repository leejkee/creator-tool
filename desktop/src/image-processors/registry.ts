import { ImageProcessorError } from "./errors";
import type {
  ImageProcessorFunction,
  ProcessorRegistry,
  ProcessorRegistration,
} from "./types";

/** Snapshot explicit identifier/function pairs; no inherited properties are callable. */
export function createProcessorRegistry(
  functions: readonly ProcessorRegistration[],
): ProcessorRegistry {
  const registry = new Map<string, ImageProcessorFunction>();
  for (const [functionId, handler] of functions) {
    if (
      typeof functionId !== "string" ||
      functionId.trim() === "" ||
      typeof handler !== "function"
    ) {
      throw new ImageProcessorError(
        "INVALID_PROCESSOR_REGISTRATION",
        "A function identifier and callable handler are required",
      );
    }
    if (registry.has(functionId)) {
      throw new ImageProcessorError(
        "DUPLICATE_PROCESSOR_FUNCTION",
        `Function is already registered: ${functionId}`,
        { functionId },
      );
    }
    registry.set(functionId, handler);
  }
  return Object.freeze({
    resolve(functionId: string): ImageProcessorFunction {
      const handler = registry.get(functionId);
      if (!handler) {
        throw new ImageProcessorError(
          "PROCESSOR_FUNCTION_NOT_FOUND",
          `Function is not registered: ${functionId}`,
          {
            functionId,
          },
        );
      }
      return handler;
    },
  });
}
