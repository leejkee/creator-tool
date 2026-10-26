import type { ExtensionFields, JsonObject } from "./json";
import type { ImageProcessor } from "./processors";

/** Corresponds to creator_document_core::DOCUMENT_VERSION. */
export type DocumentVersion = "v0.2.0";

/** Intended positive grid dimensions; Rust only decodes the pair as u32. */
export type GridLayout = readonly [rows: number, columns: number];

/** Zero-based u32 coordinates, relative to the immediate parent group. */
export type GridPosition = readonly [row: number, column: number];

/** 图片相对模块内容区域的缩放方式；不决定对齐位置。 */
export type ImageFit =
  /** 等比完整显示：整张图片放入区域内，不裁剪、不变形，比例不同时会留空。 */
  | "contain"
  /** 等比铺满：图片覆盖整个区域，超出边界的部分需要裁剪。 */
  | "cover"
  /** 拉伸铺满：宽高分别适配区域，可能改变原图比例。 */
  | "stretch"
  /** 高度适配：等比缩放至区域高度，宽度可能留空或超出。 */
  | "height"
  /** 宽度适配：等比缩放至区域宽度，高度可能留空或超出。 */
  | "width";

interface ModuleBase extends ExtensionFields {
  readonly id: string;
  /** 图片缩放方式；省略时渲染按 contain（等比完整显示）处理，不回写 JSON。 */
  readonly fit?: ImageFit;
}

/** Rust permits empty children on leaves and omits them when serializing. */
interface LeafModule extends ModuleBase {
  readonly layout?: never;
  readonly children?: readonly [];
}

export interface TextModule extends LeafModule {
  readonly type: "text";
  /** Expected text content; Rust currently preserves it as an unchecked extension. */
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

/** Intended rendering contract; Rust no longer enforces module business rules. */
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
  /** Rust decodes an object without checking its rendering fields. */
  readonly composition: JsonObject;
  readonly modules: readonly ModuleNode[];
}
