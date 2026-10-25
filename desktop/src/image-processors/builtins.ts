import { blurImage, cropCircle, cropRectangle, ImageProcessingError, scaleImage } from "../image-tools";
import type { CropCircle } from "../image-tools";
import type { JsonObject, JsonValue } from "../types";
import { createProcessorRegistry } from "./registry";
import type { ProcessorRegistration, ProcessorRegistry } from "./types";

function singleArgument(args: readonly JsonValue[]): JsonValue {
  if (args.length !== 1) {
    throw new ImageProcessingError("INVALID_IMAGE_ARGUMENT", "Expected exactly one argument after the image");
  }
  return args[0];
}

function options(args: readonly JsonValue[]): JsonObject {
  const value = singleArgument(args);
  if (!isObject(value)) {
    throw new ImageProcessingError("INVALID_IMAGE_ARGUMENT", "Expected an options object");
  }
  return value;
}

function number(params: JsonObject, key: string): number {
  const value = params[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ImageProcessingError("INVALID_IMAGE_ARGUMENT", `${key} must be a finite number`);
  }
  return value;
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function circle(value: JsonValue): CropCircle {
  if (!isObject(value)) {
    throw new ImageProcessingError("INVALID_IMAGE_ARGUMENT", "clearCircle must be a circle object");
  }
  return { centerX: number(value, "centerX"), centerY: number(value, "centerY"), radius: number(value, "radius") };
}

/** Core tools plus explicitly imported custom modules. Custom IDs cannot replace core IDs. */
export function createBuiltinProcessorRegistry(extraFunctions: readonly ProcessorRegistration[] = []): ProcessorRegistry {
  return createProcessorRegistry([
    ["image-tools.cropRectangle", (source, ...args) => {
      const params = options(args);
      return cropRectangle(source, {
        x: number(params, "x"), y: number(params, "y"),
        width: number(params, "width"), height: number(params, "height"),
      });
    }],
    ["image-tools.cropCircle", (source, ...args) => {
      const params = options(args);
      return cropCircle(source, {
        centerX: number(params, "centerX"), centerY: number(params, "centerY"), radius: number(params, "radius"),
      });
    }],
    ["image-tools.scaleImage", (source, ...args) => {
      const ratio = singleArgument(args);
      if (typeof ratio !== "number") {
        throw new ImageProcessingError("INVALID_IMAGE_ARGUMENT", "ratio must be a number");
      }
      return scaleImage(source, ratio);
    }],
    ["image-tools.blurImage", (source, ...args) => {
      const params = options(args);
      return blurImage(source, {
        blurRadius: number(params, "blurRadius"),
        ...(params.clearCircle === undefined ? {} : { clearCircle: circle(params.clearCircle) }),
      });
    }],
    ...extraFunctions,
  ]);
}
