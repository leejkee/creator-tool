import type { RenderTextModule } from "../render-input";
import { checkCancelled, failure } from "./control";
import type { Control } from "./control";
import type { PixelBox } from "./types";

function wordTokens(paragraph: string): string[] {
  if (typeof Intl.Segmenter !== "function") {
    throw failure("TEXT_LAYOUT_FAILED", "当前环境不支持完整字素和单词分割");
  }
  const words = new Intl.Segmenter("en", { granularity: "word" });
  const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const result: string[] = [];
  for (const item of words.segment(paragraph)) {
    // Word-like Latin/numeric runs stay intact, even when wider than an entire line.
    if (
      item.isWordLike &&
      !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
        item.segment,
      )
    ) {
      result.push(item.segment);
    } else {
      for (const grapheme of graphemes.segment(item.segment)) {
        result.push(grapheme.segment);
      }
    }
  }
  return result;
}

function linesFor(
  context: CanvasRenderingContext2D,
  module: RenderTextModule,
  width: number,
  control: Control,
): string[] {
  const paragraphs = module.text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .split("\n");
  if (!module.style.wrap) {
    return paragraphs;
  }
  const result: string[] = [];
  for (const paragraph of paragraphs) {
    let line = "";
    for (const token of wordTokens(paragraph)) {
      checkCancelled(control);
      const candidate = line + token;
      const measured = context.measureText(candidate).width;
      if (!Number.isFinite(measured)) {
        throw failure("TEXT_LAYOUT_FAILED", "文字测量结果无法表示");
      }
      if (line.length > 0 && measured > width) {
        result.push(line);
        line = token;
      } else {
        line = candidate;
      }
    }
    result.push(line);
  }
  return result;
}

export function drawText(
  context: CanvasRenderingContext2D,
  module: RenderTextModule,
  box: PixelBox,
  font: string,
  control: Control,
): void {
  context.font = "10px sans-serif";
  context.font = font;
  const acceptedSize = /(?:^|\s)(\d+(?:\.\d*)?(?:e[+-]?\d+)?)px(?:\s|\/)/i.exec(
    context.font,
  );
  if (!acceptedSize || Number(acceptedSize[1]) !== module.style.fontSize) {
    throw failure("TEXT_LAYOUT_FAILED", "Canvas 无法使用配置的字号");
  }
  context.direction = "ltr";
  context.textAlign = module.style.align;
  context.textBaseline = "alphabetic";
  context.fillStyle = module.style.color;
  context.fontKerning = "normal";
  const lines = linesFor(context, module, box.width, control);
  const metrics = context.measureText("Mg国");
  const ascent =
    metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
  const descent =
    metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
  const blockHeight = lines.length * module.style.lineHeight;
  if (![ascent, descent, blockHeight].every(Number.isFinite)) {
    throw failure("TEXT_LAYOUT_FAILED", "文字行框尺寸无法表示");
  }
  const vertical =
    module.style.verticalAlign === "top"
      ? 0
      : module.style.verticalAlign === "center"
        ? 0.5
        : 1;
  const x =
    box.x +
    (module.style.align === "left"
      ? 0
      : module.style.align === "center"
        ? box.width / 2
        : box.width);
  const top = box.y + (box.height - blockHeight) * vertical;
  const offset = (module.style.lineHeight - ascent - descent) / 2 + ascent;
  for (let i = 0; i < lines.length; i++) {
    checkCancelled(control);
    if (lines[i].length === 0) {
      continue;
    }
    const baseline = top + i * module.style.lineHeight + offset;
    const ink = context.measureText(lines[i]);
    // Cull only truly invisible ink. Small lineHeight is allowed to overlap adjacent rows.
    if (
      baseline + ink.actualBoundingBoxDescent < box.y ||
      baseline - ink.actualBoundingBoxAscent > box.y + box.height
    ) {
      continue;
    }
    context.fillText(lines[i], x, baseline);
  }
}
