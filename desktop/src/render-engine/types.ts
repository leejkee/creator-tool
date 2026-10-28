import type {
  ImageProcessorErrorCode,
  ProcessorRegistry,
} from "../image-processors";
import type { RenderIssueCode } from "../render-input";
import type { ModuleType } from "../types";

export type EngineIssueCode =
  | RenderIssueCode
  | ImageProcessorErrorCode
  | "INVALID_RENDER_CONTEXT"
  | "LAYOUT_OVERFLOW"
  | "OUTPUT_UNAVAILABLE"
  | "CANVAS_UNAVAILABLE"
  | "IMAGE_UNAVAILABLE"
  | "FONT_UNAVAILABLE"
  | "TEXT_LAYOUT_FAILED"
  | "RESOURCE_CHANGED"
  | "RESOURCE_CHECK_FAILED"
  | "RESOURCE_PROVIDER_REQUIRED"
  | "OPERATION_TIMEOUT"
  | "RENDER_CANCELLED"
  | "OUTPUT_SCALED"
  | "DRAW_FAILED"
  | "PNG_ENCODING_FAILED";

export interface EngineIssue {
  readonly code: EngineIssueCode;
  readonly message: string;
  readonly path: string;
  readonly moduleId?: string;
  readonly functionId?: string;
  readonly stepIndex?: number;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RenderAsset {
  /** Independent encoded local file bytes, not a URL or a decoded image. */
  readonly bytes: Uint8Array;
  readonly version: string;
}

/** Providers must resolve paths against the supplied JSON directory. */
export interface RenderResourceProvider {
  readonly readAsset: (
    assetPath: string,
    documentDirectory: string,
  ) => Promise<RenderAsset>;
  /** null denotes a missing or unreadable file. Compare actual file content. */
  readonly assetVersion: (
    assetPath: string,
    documentDirectory: string,
  ) => Promise<string | null>;
}

export interface RenderOptions {
  readonly documentDirectory: string;
  readonly resources?: RenderResourceProvider;
  readonly processors?: ProcessorRegistry;
  readonly signal?: AbortSignal;
  /** Positive safe integer; defaults to 30 seconds for each asynchronous operation. */
  readonly timeoutMs?: number;
  /** Optional caller-owned concurrency metadata, never fetched or committed by Engine. */
  readonly session?: { readonly id: string; readonly version: number };
}

export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

export interface PixelBox extends PixelSize {
  readonly x: number;
  readonly y: number;
}

export interface ModuleLayout {
  readonly moduleId: string;
  readonly type: ModuleType;
  readonly path: string;
  /** Final absolute coordinates, with at most one decimal place. */
  readonly box: PixelBox;
  readonly contentBox?: PixelBox;
  readonly borderWidth: number;
  readonly radius: number;
  readonly paddingX: number;
  readonly paddingY: number;
  readonly gapX: number;
  readonly gapY: number;
}

export interface RenderedImage extends PixelSize {
  /** Display only: callers must not modify pixels or dimensions before PNG encoding. */
  readonly canvas: HTMLCanvasElement;
  readonly naturalSize: PixelSize;
  readonly scale: number;
  readonly layout: readonly ModuleLayout[];
  readonly warnings: readonly EngineIssue[];
  readonly source: {
    readonly documentId: string;
    readonly revision: number;
    readonly session?: { readonly id: string; readonly version: number };
  };
}

export interface EngineFailureResult {
  readonly ok: false;
  readonly errors: readonly EngineIssue[];
  readonly warnings: readonly EngineIssue[];
}

export type RenderResult =
  | {
      readonly ok: true;
      readonly image: RenderedImage;
      readonly warnings: readonly EngineIssue[];
    }
  | EngineFailureResult;

export interface PngImage extends PixelSize {
  readonly blob: Blob;
  readonly bytes: Uint8Array;
}

export type PngEncodingResult =
  | {
      readonly ok: true;
      readonly png: PngImage;
      readonly warnings: readonly EngineIssue[];
    }
  | EngineFailureResult;

export type PngRenderResult =
  | {
      readonly ok: true;
      readonly image: RenderedImage;
      readonly png: PngImage;
      readonly warnings: readonly EngineIssue[];
    }
  | EngineFailureResult;
