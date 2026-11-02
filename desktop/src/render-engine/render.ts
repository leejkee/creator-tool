import { createBuiltinProcessorRegistry } from "../image-processors";
import type { ProcessorRegistry } from "../image-processors";
import { validateRenderDocument } from "../render-input";
import type {
  RenderImageModule,
  RenderModule,
  RenderTextModule,
} from "../render-input";
import { AssetScope } from "./assets";
import type { LoadedImage } from "./assets";
import {
  checkCancelled,
  EngineFailure,
  failure,
  messageOf,
  resolveControl,
} from "./control";
import { FontScope } from "./fonts";
import { computeLayout } from "./layout";
import { paint } from "./paint";
import { createSurface } from "./surface";
import type {
  EngineIssue,
  ModuleLayout,
  RenderOptions,
  RenderResult,
} from "./types";

function validateOptions(options: RenderOptions): void {
  if (
    !options ||
    typeof options.documentDirectory !== "string" ||
    options.documentDirectory.trim().length === 0 ||
    options.documentDirectory.includes("\0")
  ) {
    throw failure("INVALID_RENDER_CONTEXT", "必须明确提供图片 JSON 所在目录");
  }
  if (
    options.resources &&
    (typeof options.resources.readAsset !== "function" ||
      typeof options.resources.assetVersion !== "function")
  ) {
    throw failure(
      "INVALID_RENDER_CONTEXT",
      "资源提供方必须具有读取和版本查询能力",
    );
  }
  if (options.processors && typeof options.processors.resolve !== "function") {
    throw failure(
      "INVALID_RENDER_CONTEXT",
      "处理函数注册表必须提供入口查询能力",
    );
  }
  if (
    options.session &&
    (typeof options.session.id !== "string" ||
      options.session.id.trim().length === 0 ||
      !Number.isSafeInteger(options.session.version) ||
      options.session.version < 0)
  ) {
    throw failure(
      "INVALID_RENDER_CONTEXT",
      "来源会话必须具有非空标识和非负安全整数版本",
    );
  }
}

/** Independent snapshot in, independent Canvas out. Never commits or saves a document. */
export async function renderDocument(
  documentValue: unknown,
  options: RenderOptions,
): Promise<RenderResult> {
  const warnings: EngineIssue[] = [];
  let canvas: HTMLCanvasElement | undefined;
  let assets: AssetScope | undefined;
  let fonts: FontScope | undefined;
  try {
    validateOptions(options);
    // Snapshot context before the first asynchronous step, just like document validation.
    const context: RenderOptions = {
      documentDirectory: options.documentDirectory,
      resources: options.resources
        ? {
            readAsset: options.resources.readAsset.bind(options.resources),
            assetVersion: options.resources.assetVersion.bind(
              options.resources,
            ),
          }
        : undefined,
      processors: options.processors,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      session: options.session ? { ...options.session } : undefined,
    };
    const control = resolveControl(context);
    const validated = validateRenderDocument(documentValue);
    warnings.push(...validated.warnings);
    if (!validated.ok) {
      return { ok: false, errors: validated.errors, warnings };
    }
    const raw = documentValue as { documentId: string; revision: number };
    const source = Object.freeze({
      documentId: raw.documentId,
      revision: raw.revision,
      session: context.session
        ? Object.freeze({ ...context.session })
        : undefined,
    });
    const layout = computeLayout(validated.input);
    warnings.push(...layout.warnings);
    const originalRegistry =
      context.processors ?? createBuiltinProcessorRegistry();
    const registry: ProcessorRegistry = {
      // Actual lookup stays deferred: missing images must skip the complete chain.
      resolve: originalRegistry.resolve.bind(originalRegistry),
    };
    const surface = createSurface(layout.width, layout.height);
    canvas = surface.canvas;
    assets = new AssetScope(context, control, registry, warnings);
    fonts = new FontScope(control, warnings);
    const images = new Map<RenderImageModule, LoadedImage>();
    const backgrounds = new Map<RenderModule, LoadedImage>();
    const fontValues = new Map<RenderTextModule, string>();
    for (const node of layout.modules) {
      checkCancelled(control);
      const module = node.module;
      if (module.style.background?.type === "image") {
        backgrounds.set(
          module,
          await assets.load(
            module.style.background.assetPath,
            module,
            "style.background.assetPath",
          ),
        );
      }
      if (module.type === "image") {
        images.set(module, await assets.image(module));
      } else if (module.type === "text") {
        fontValues.set(module, await fonts.font(module));
      }
    }
    await paint(
      layout,
      surface.context,
      { images, backgrounds, fonts: fontValues },
      control,
    );
    await assets.verify();
    checkCancelled(control);
    const modules: ModuleLayout[] = layout.modules.map(
      ({
        moduleId,
        type,
        path,
        box,
        contentBox,
        borderWidth,
        radius,
        paddingX,
        paddingY,
        gapX,
        gapY,
      }) =>
        Object.freeze({
          moduleId,
          type,
          path,
          box,
          contentBox,
          borderWidth,
          radius,
          paddingX,
          paddingY,
          gapX,
          gapY,
        }),
    );
    const finalWarnings = Object.freeze(warnings);
    const image = Object.freeze({
      canvas,
      width: layout.width,
      height: layout.height,
      naturalSize: Object.freeze(layout.naturalSize),
      scale: layout.scale,
      layout: Object.freeze(modules),
      warnings: finalWarnings,
      source,
    });
    canvas = undefined;
    return { ok: true, image, warnings: finalWarnings };
  } catch (error) {
    const issue =
      error instanceof EngineFailure
        ? error.issue
        : failure("DRAW_FAILED", messageOf(error), {}, error).issue;
    return { ok: false, errors: [issue], warnings };
  } finally {
    assets?.dispose();
    fonts?.dispose();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
