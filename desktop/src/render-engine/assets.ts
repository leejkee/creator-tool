import notFoundSvg from "../assets/image-not-found.svg?raw";
import { cropRectangle } from "../image-tools";
import type { ImageSource } from "../image-tools";
import { sourceSize } from "../image-tools/canvas";
import { ImageProcessorError, runImageProcessors } from "../image-processors";
import type { ProcessorRegistry } from "../image-processors";
import type { RenderImageModule, RenderModule } from "../render-input";
import {
  checkCancelled,
  EngineFailure,
  failure,
  located,
  messageOf,
  waitFor,
} from "./control";
import type { Control } from "./control";
import { prepareEncodedImage } from "./encoded-image";
import { createSurface } from "./surface";
import type { EngineIssue, RenderAsset, RenderOptions } from "./types";

export interface LoadedImage {
  readonly source: ImageSource;
  readonly placeholder: boolean;
}

interface ResourceState {
  version: string | null;
  image?: ImageSource;
  error?: string;
  readonly location: { moduleId: string; path: string };
}

export class AssetScope {
  private readonly files = new Map<string, ResourceState>();
  private readonly bitmaps = new Set<ImageBitmap>();
  private readonly processed = new Set<HTMLCanvasElement | OffscreenCanvas>();
  private placeholder?: ImageBitmap;
  private disposed = false;

  constructor(
    private readonly options: RenderOptions,
    private readonly control: Control,
    private readonly registry: ProcessorRegistry,
    private readonly warnings: EngineIssue[],
  ) {}

  private async decode(blob: Blob): Promise<ImageBitmap> {
    if (typeof createImageBitmap !== "function") {
      throw failure("CANVAS_UNAVAILABLE", "当前环境不支持静态图片解码");
    }
    const bitmap = await waitFor(
      () =>
        createImageBitmap(blob, {
          imageOrientation: "none",
          colorSpaceConversion: "default",
          premultiplyAlpha: "default",
        }),
      this.control,
      (late) => late.close(),
    );
    if (this.disposed) {
      bitmap.close();
      throw failure("RENDER_CANCELLED", "资源作用域已释放");
    }
    this.bitmaps.add(bitmap);
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      throw new Error("解码后的图片尺寸为空");
    }
    return bitmap;
  }

  private async fallback(): Promise<LoadedImage> {
    this.placeholder ??= await this.decode(
      new Blob([notFoundSvg], { type: "image/svg+xml" }),
    );
    return { source: this.placeholder, placeholder: true };
  }

  async load(
    assetPath: string | undefined,
    module: RenderModule,
    field: string,
  ): Promise<LoadedImage> {
    checkCancelled(this.control);
    if (assetPath === undefined) {
      return this.fallback();
    }
    const provider = this.options.resources;
    const location = { moduleId: module.id, path: `${module.path}.${field}` };
    if (
      !provider ||
      typeof provider.readAsset !== "function" ||
      typeof provider.assetVersion !== "function"
    ) {
      throw failure(
        "RESOURCE_PROVIDER_REQUIRED",
        "读取本地图片需要资源读取及版本查询能力",
        location,
      );
    }
    let state = this.files.get(assetPath);
    if (!state) {
      state = { version: null, location };
      this.files.set(assetPath, state);
      try {
        const asset: RenderAsset = await waitFor(
          () => provider.readAsset(assetPath, this.options.documentDirectory),
          this.control,
        );
        if (
          !(asset.bytes instanceof Uint8Array) ||
          typeof asset.version !== "string" ||
          asset.version.length === 0
        ) {
          throw failure(
            "INVALID_RENDER_CONTEXT",
            "资源读取结果必须包含图片字节及非空版本",
            location,
          );
        }
        state.version = asset.version;
        const prepared = prepareEncodedImage(asset.bytes);
        const bitmap = await this.decode(prepared.blob);
        if (prepared.frame) {
          const frame = prepared.frame;
          const surface = createSurface(frame.canvasWidth, frame.canvasHeight);
          surface.context.drawImage(bitmap, frame.x, frame.y);
          this.processed.add(surface.canvas);
          state.image = surface.canvas;
        } else {
          state.image = bitmap;
        }
      } catch (error) {
        if (error instanceof EngineFailure) {
          throw located(error, location);
        }
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "INVALID_RENDER_CONTEXT"
        ) {
          throw failure(
            "INVALID_RENDER_CONTEXT",
            messageOf(error),
            location,
            error,
          );
        }
        state.error = messageOf(error);
      }
    }
    if (state.image) {
      return { source: state.image, placeholder: false };
    }
    this.warnings.push({
      code: "IMAGE_UNAVAILABLE",
      ...location,
      message: `无法使用图片 ${assetPath}，已改用缺图占位图：${state.error ?? "图片不可用"}`,
    });
    try {
      return await this.fallback();
    } catch (error) {
      throw located(error, location);
    }
  }

  async image(module: RenderImageModule): Promise<LoadedImage> {
    const loaded = await this.load(module.assetPath, module, "assetPath");
    if (loaded.placeholder || module.processors.length === 0) {
      return loaded;
    }
    const registry: ProcessorRegistry = {
      resolve: (functionId) => {
        const handler = this.registry.resolve(functionId);
        return (source, ...args) =>
          waitFor(() => handler(source, ...args), this.control);
      },
    };
    try {
      const source = await runImageProcessors(
        loaded.source,
        module.processors,
        registry,
      );
      checkCancelled(this.control);
      // A handler can return a borrowed image; only dispose Engine's own independent copy.
      const size = sourceSize(source);
      const copy = cropRectangle(source, { x: 0, y: 0, ...size });
      this.processed.add(copy);
      return { source: copy, placeholder: false };
    } catch (error) {
      const location = {
        moduleId: module.id,
        path: `${module.path}.processors`,
      };
      if (error instanceof ImageProcessorError) {
        const cause = error.cause;
        const code =
          cause instanceof EngineFailure ? cause.issue.code : error.code;
        throw failure(
          code,
          `图片处理失败：${messageOf(cause ?? error)}`,
          {
            ...location,
            ...error.context,
            path:
              error.context.stepIndex === undefined
                ? location.path
                : `${location.path}[${error.context.stepIndex}]`,
          },
          error,
        );
      }
      throw located(error, location);
    }
  }

  async verify(): Promise<void> {
    const provider = this.options.resources;
    if (!provider) {
      return;
    }
    for (const [assetPath, state] of this.files) {
      let version: string | null;
      try {
        version = await waitFor(
          () =>
            provider.assetVersion(assetPath, this.options.documentDirectory),
          this.control,
        );
        if (
          version !== null &&
          (typeof version !== "string" || version.length === 0)
        ) {
          throw failure(
            "INVALID_RENDER_CONTEXT",
            "资源版本查询必须返回非空字符串或 null",
            state.location,
          );
        }
      } catch (error) {
        if (error instanceof EngineFailure) {
          throw located(error, state.location);
        }
        throw failure(
          "RESOURCE_CHECK_FAILED",
          `无法确认素材是否变化：${assetPath}：${messageOf(error)}`,
          state.location,
          error,
        );
      }
      if (version !== state.version) {
        throw failure(
          "RESOURCE_CHANGED",
          `渲染期间素材已变化，请重新渲染：${assetPath}`,
          {
            ...state.location,
            details: { assetPath },
          },
        );
      }
    }
  }

  private release(source: ImageSource): void {
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
      source.close();
    } else if (
      source instanceof HTMLCanvasElement ||
      (typeof OffscreenCanvas !== "undefined" &&
        source instanceof OffscreenCanvas)
    ) {
      source.width = 0;
      source.height = 0;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const bitmap of this.bitmaps) {
      bitmap.close();
    }
    for (const canvas of this.processed) {
      this.release(canvas);
    }
    this.files.clear();
    this.bitmaps.clear();
    this.processed.clear();
  }
}
