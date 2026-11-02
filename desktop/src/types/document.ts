import type { ExtensionFields, JsonObject } from "./json";
import type { ImageProcessor } from "./processors";
import type {
  ContentStyle,
  ImageFit,
  ModuleStyle,
  TextStyle,
} from "./appearance";

export type { ImageFit } from "./appearance";

/** Corresponds to creator_document_core::DOCUMENT_VERSION. */
export type DocumentVersion = "v0.2.0";

/** Intended positive grid dimensions; Rust only decodes the pair as u32. */
export type GridLayout = readonly [rows: number, columns: number];

/** Zero-based u32 coordinates, relative to the immediate parent module. */
export type GridPosition = readonly [row: number, column: number];

interface ModuleBase extends ExtensionFields {
  readonly id: string;
  readonly style?: ModuleStyle;
}

/** Rust permits empty children on leaves and omits them when serializing. */
interface LeafModule extends ModuleBase {
  /** Fixed outer box dimensions, in positive integer pixels. */
  readonly width: number;
  readonly height: number;
  readonly layout?: never;
  readonly children?: readonly [];
}

export interface TextModule extends LeafModule {
  readonly type: "text";
  readonly style?: TextStyle;
  /** Expected text content; Rust currently preserves it as an unchecked extension. */
  readonly text: string;
}

export interface ImageModule extends LeafModule {
  readonly type: "image";
  readonly style?: ContentStyle;
  /** Omitted means contain; validated at runtime in the TS rendering layer. */
  readonly fit?: ImageFit;
  /** Prepared local file; relative paths use the JSON document's directory. */
  readonly assetPath?: string;
  /** Runs in array order before fitting the result into the module bounds. */
  readonly processors?: readonly ImageProcessor[];
}

export interface RectModule extends LeafModule {
  readonly type: "rect";
}

export interface LayoutModule extends ModuleBase {
  /** Composition is determined by layout, not a separate content type. */
  readonly type?: never;
  readonly padding?: number;
  readonly gap?: number;
  readonly layout: GridLayout;
  /** Omitted when empty. Array order does not determine grid coordinates. */
  readonly children?: readonly PlacedModule[];
}

/** Intended rendering contract; Rust no longer enforces module business rules. */
export type ModuleNode = TextModule | ImageModule | RectModule | LayoutModule;

/** Content kinds belong only to minimum modules. */
export type ModuleType = "text" | "image" | "rect";

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
  /** Rust decodes an object without checking its rendering fields. */
  readonly composition: JsonObject;
  readonly modules: readonly ModuleNode[];
}
