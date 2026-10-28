import type {
  GridLayout,
  GridPosition,
  HorizontalAlign,
  ImageFit,
  ImageProcessor,
  VerticalAlign,
} from "../types";

export type RenderIssueCode =
  | "INVALID_PARAMETER"
  | "DUPLICATE_MODULE_ID"
  | "DUPLICATE_POSITION"
  | "POSITION_OUT_OF_BOUNDS"
  | "INVALID_STRUCTURE"
  | "NO_RENDERABLE_CONTENT"
  | "UNKNOWN_PARAMETER"
  | "UNSUPPORTED_PARAMETER"
  | "MISSING_IMAGE_SOURCE";

export interface RenderIssue {
  readonly code: RenderIssueCode;
  /** JSON path, for example $.modules[0].style.fontSize. */
  readonly path: string;
  readonly message: string;
  readonly moduleId?: string;
}

export interface RenderBorder {
  /** Solid border, contained inside the module's outer bounds. */
  readonly width: number;
  readonly color: string;
}

export type RenderBackground =
  | { readonly type: "color"; readonly color: string }
  | {
      readonly type: "image";
      /** Absent means use the built-in warning image; resource loading is deferred. */
      readonly assetPath?: string;
      readonly fit: ImageFit;
      readonly align: HorizontalAlign;
      readonly verticalAlign: VerticalAlign;
    };

export interface RenderStyle {
  /** Engine clamps this to half the shorter side after computing the box. */
  readonly radius: number;
  readonly opacity: number;
  readonly border?: RenderBorder;
  /** Absent means transparent. */
  readonly background?: RenderBackground;
}

export interface RenderContentStyle extends RenderStyle {
  readonly align: HorizontalAlign;
  readonly verticalAlign: VerticalAlign;
  readonly padding: number;
}

export interface RenderTextStyle extends RenderContentStyle {
  readonly fontSize: number;
  readonly color: string;
  readonly bold: boolean;
  readonly lineHeight: number;
  readonly wrap: boolean;
  readonly fontFamily: string;
}

interface RenderModuleBase {
  readonly id: string;
  /** Original location, retained when empty siblings are removed. */
  readonly path: string;
  readonly style: RenderStyle;
}

interface RenderLeaf extends RenderModuleBase {
  readonly width: number;
  readonly height: number;
}

export interface RenderTextModule extends RenderLeaf {
  readonly type: "text";
  readonly text: string;
  readonly style: RenderTextStyle;
}

export interface RenderImageModule extends RenderLeaf {
  readonly type: "image";
  readonly assetPath?: string;
  readonly fit: ImageFit;
  readonly style: RenderContentStyle;
  readonly processors: readonly ImageProcessor[];
}

export interface RenderRectModule extends RenderLeaf {
  readonly type: "rect";
}

export interface RenderPlacedModule {
  readonly position: GridPosition;
  readonly module: RenderModule;
}

export interface RenderGroupModule extends RenderModuleBase {
  readonly type: "group";
  /** Original grid bounds; Engine folds empty rows and columns without rewriting JSON. */
  readonly layout: GridLayout;
  readonly padding: number;
  readonly gap: number;
  readonly children: readonly RenderPlacedModule[];
}

export type RenderModule =
  RenderTextModule | RenderImageModule | RenderRectModule | RenderGroupModule;

export interface DocumentRenderInput {
  readonly composition: {
    readonly width: number | "auto";
    readonly height: number | "auto";
  };
  /** Empty text and empty groups have already been pruned from this independent tree. */
  readonly root: RenderModule;
}

export type RenderValidationResult =
  | {
      readonly ok: true;
      readonly input: DocumentRenderInput;
      readonly warnings: readonly RenderIssue[];
    }
  | {
      readonly ok: false;
      readonly errors: readonly RenderIssue[];
      readonly warnings: readonly RenderIssue[];
    };
