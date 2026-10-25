import type { JsonValue } from "./json";

/** Wire format shared with Rust. The Engine prepends the current decoded image. */
export type ImageProcessor = readonly [functionId: string, ...args: JsonValue[]];
