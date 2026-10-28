import {
  EngineFailure,
  checkCancelled,
  failure,
  messageOf,
  resolveControl,
  waitFor,
} from "./control";
import { renderDocument } from "./render";
import type {
  PngEncodingResult,
  PngRenderResult,
  RenderOptions,
  RenderedImage,
} from "./types";

/** Encode this completed raster, without rerendering or consulting resource providers. */
export async function encodePng(
  image: RenderedImage,
  options: Pick<RenderOptions, "signal" | "timeoutMs"> = {},
): Promise<PngEncodingResult> {
  try {
    const control = resolveControl(options);
    if (
      image.canvas.width !== image.width ||
      image.canvas.height !== image.height ||
      image.width <= 0 ||
      image.height <= 0
    ) {
      throw failure(
        "PNG_ENCODING_FAILED",
        "结果画布尺寸已改变或画布已释放，请重新渲染",
      );
    }
    const blob = await waitFor(
      () =>
        new Promise<Blob>((resolve, reject) => {
          image.canvas.toBlob((value) => {
            if (value) {
              resolve(value);
            } else {
              reject(failure("PNG_ENCODING_FAILED", "Canvas 无法编码为 PNG"));
            }
          }, "image/png");
        }),
      control,
    );
    const bytes = new Uint8Array(
      await waitFor(() => blob.arrayBuffer(), control),
    );
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    const view = new DataView(bytes.buffer);
    if (
      bytes.length < 33 ||
      blob.type !== "image/png" ||
      signature.some((value, i) => bytes[i] !== value) ||
      view.getUint32(16) !== image.width ||
      view.getUint32(20) !== image.height
    ) {
      throw failure("PNG_ENCODING_FAILED", "PNG 数据或实际像素尺寸不正确");
    }
    checkCancelled(control);
    return {
      ok: true,
      png: { blob, bytes, width: image.width, height: image.height },
      warnings: image.warnings,
    };
  } catch (error) {
    const issue =
      error instanceof EngineFailure
        ? error.issue
        : failure("PNG_ENCODING_FAILED", messageOf(error), {}, error).issue;
    return { ok: false, errors: [issue], warnings: image?.warnings ?? [] };
  }
}

export async function renderDocumentToPng(
  documentValue: unknown,
  options: RenderOptions,
): Promise<PngRenderResult> {
  const rendered = await renderDocument(documentValue, options);
  if (!rendered.ok) {
    return rendered;
  }
  const encoded = await encodePng(rendered.image, options);
  if (!encoded.ok) {
    rendered.image.canvas.width = 0;
    rendered.image.canvas.height = 0;
    return { ...encoded, warnings: rendered.warnings };
  }
  return {
    ok: true,
    image: rendered.image,
    png: encoded.png,
    warnings: rendered.warnings,
  };
}
