import type { ExtensionFields, JsonObject } from "./json";
import type { ImageProcessor } from "./processors";

/** Corresponds to creator_document_core::DOCUMENT_VERSION. */
export type DocumentVersion = "v0.2.0";

/** Positive u32 dimensions; range and positivity are checked by Rust. */
export type GridLayout = readonly [rows: number, columns: number];

/** Zero-based u32 coordinates, relative to the immediate parent group. */
export type GridPosition = readonly [row: number, column: number];

export type ImageFit = "contain" | "cover" | "stretch" | "height" | "width";

interface ModuleBase extends ExtensionFields {
  readonly id: string;
  readonly fit?: ImageFit;
}

/** Rust permits empty children on leaves and omits them when serializing. */
interface LeafModule extends ModuleBase {
  readonly layout?: never;
  readonly children?: readonly [];
}

export interface TextModule extends LeafModule {
  readonly type: "text";
  /** Required by Rust; the empty string is valid. */
  readonly text: string;
}

export interface ImageModule extends LeafModule {
  readonly type: "image";
  /** Runs in array order before fitting the result into the module bounds. */
  readonly processors?: readonly ImageProcessor[];
}

export interface RectModule extends LeafModule {
  readonly type: "rect";
}

export interface GroupModule extends ModuleBase {
  readonly type: "group";
  readonly layout: GridLayout;
  /** Omitted when empty. Array order does not determine grid coordinates. */
  readonly children?: readonly PlacedModule[];
}

/** Validated view of the serialized Rust Node, discriminated by `type`. */
export type ModuleNode = TextModule | ImageModule | RectModule | GroupModule;

export type ModuleType = ModuleNode["type"];

/** Corresponds to Rust PlacedModule; position belongs to the parent relation. */
export interface PlacedModule<T = ModuleNode> extends ExtensionFields {
  readonly position: GridPosition;
  readonly module: T;
}

export interface ImageDocument extends ExtensionFields {
  readonly "image-create-tool-version": DocumentVersion;
  readonly documentId: string;
  /** Rust u64. TS number requires values within Number.MAX_SAFE_INTEGER. */
  readonly revision: number;
  /** Current Rust validation guarantees an object, not its rendering fields. */
  readonly composition: JsonObject;
  readonly modules: readonly ModuleNode[];
}
