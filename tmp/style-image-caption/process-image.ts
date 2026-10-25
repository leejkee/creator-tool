import { createBuiltinProcessorRegistry, runImageProcessors } from "../../desktop/src/image-processors";
import type { ImageSource } from "../../desktop/src/image-tools";
import type { ImageModule } from "../../desktop/src/types";
import { process } from "./square-focus";

const registry = createBuiltinProcessorRegistry([
  ["square-focus.process", process],
]);

/** Actual JSON-to-function dispatch for the example, before Engine sizing and layout. */
export function processImageModule(source: ImageSource, module: ImageModule): Promise<ImageSource> {
  return runImageProcessors(source, module.processors ?? [], registry);
}
