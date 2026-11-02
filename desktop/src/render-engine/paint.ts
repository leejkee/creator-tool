import { sourceSize } from "../image-tools/canvas";
import type {
  RenderImageModule,
  RenderModule,
  RenderTextModule,
} from "../render-input";
import type { HorizontalAlign, ImageFit, VerticalAlign } from "../types";
import type { LoadedImage } from "./assets";
import { checkCancelled, located, yieldToHost } from "./control";
import type { Control } from "./control";
import type { LayoutNode, LayoutResult } from "./layout";
import { pixel } from "./layout";
import { assertSurface, createSurface } from "./surface";
import { drawText } from "./text";
import type { PixelBox } from "./types";

export interface PreparedResources {
  readonly images: ReadonlyMap<RenderImageModule, LoadedImage>;
  readonly backgrounds: ReadonlyMap<RenderModule, LoadedImage>;
  readonly fonts: ReadonlyMap<RenderTextModule, string>;
}

function roundedPath(
  context: CanvasRenderingContext2D,
  box: PixelBox,
  radius: number,
): void {
  const { x, y, width, height } = box;
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function fittedImage(
  context: CanvasRenderingContext2D,
  loaded: LoadedImage,
  box: PixelBox,
  fit: ImageFit,
  align: HorizontalAlign,
  verticalAlign: VerticalAlign,
): void {
  if (box.width <= 0 || box.height <= 0) {
    return;
  }
  if (loaded.placeholder) {
    fit = "contain";
    align = "center";
    verticalAlign = "center";
  }
  const source = sourceSize(loaded.source);
  let scaleX = box.width / source.width;
  let scaleY = box.height / source.height;
  if (fit !== "stretch") {
    const scale =
      fit === "height"
        ? scaleY
        : fit === "width"
          ? scaleX
          : fit === "cover"
            ? Math.max(scaleX, scaleY)
            : Math.min(scaleX, scaleY);
    scaleX = scale;
    scaleY = scale;
  }
  const horizontal = align === "left" ? 0 : align === "center" ? 0.5 : 1;
  const vertical =
    verticalAlign === "top" ? 0 : verticalAlign === "center" ? 0.5 : 1;
  const sourceWidth = Math.min(source.width, box.width / scaleX);
  const sourceHeight = Math.min(source.height, box.height / scaleY);
  const width = sourceWidth * scaleX;
  const height = sourceHeight * scaleY;
  const destinationWidth = pixel(width);
  const destinationHeight = pixel(height);
  if (destinationWidth <= 0 || destinationHeight <= 0) {
    return;
  }
  context.drawImage(
    loaded.source,
    (source.width - sourceWidth) * horizontal,
    (source.height - sourceHeight) * vertical,
    sourceWidth,
    sourceHeight,
    pixel(box.x + (box.width - width) * horizontal),
    pixel(box.y + (box.height - height) * vertical),
    destinationWidth,
    destinationHeight,
  );
}

function background(
  context: CanvasRenderingContext2D,
  node: LayoutNode,
  resources: PreparedResources,
): void {
  const value = node.module.style.background;
  if (value?.type === "color") {
    context.fillStyle = value.color;
    context.fillRect(
      node.box.x - 1,
      node.box.y - 1,
      node.box.width + 2,
      node.box.height + 2,
    );
  } else if (value?.type === "image") {
    fittedImage(
      context,
      resources.backgrounds.get(node.module)!,
      node.box,
      value.fit,
      value.align,
      value.verticalAlign,
    );
  }
}

function border(context: CanvasRenderingContext2D, node: LayoutNode): void {
  const value = node.module.style.border;
  if (!value || node.borderWidth <= 0) {
    return;
  }
  context.fillStyle = value.color;
  context.beginPath();
  // The active outer clip defines the edge once; subtract the rounded inner hole.
  context.rect(
    node.box.x - 1,
    node.box.y - 1,
    node.box.width + 2,
    node.box.height + 2,
  );
  const inner = {
    x: node.box.x + node.borderWidth,
    y: node.box.y + node.borderWidth,
    width: node.box.width - 2 * node.borderWidth,
    height: node.box.height - 2 * node.borderWidth,
  };
  if (inner.width > 0 && inner.height > 0) {
    roundedPath(context, inner, Math.max(0, node.radius - node.borderWidth));
  }
  context.fill("evenodd");
}

export async function paint(
  layout: LayoutResult,
  context: CanvasRenderingContext2D,
  resources: PreparedResources,
  control: Control,
): Promise<void> {
  interface Layer {
    canvas: HTMLCanvasElement;
    destination: CanvasRenderingContext2D;
    x: number;
    y: number;
  }
  type Frame = {
    node: LayoutNode;
    context: CanvasRenderingContext2D;
    finish?: boolean;
    layer?: Layer;
  };
  const pending: Frame[] = [{ node: layout.root, context }];
  const layers = new Set<HTMLCanvasElement>();
  let count = 0;
  try {
    while (pending.length > 0) {
      checkCancelled(control);
      if (++count % 32 === 0) {
        await yieldToHost(control);
      }
      const frame = pending.pop()!;
      const { node } = frame;
      let target = frame.context;
      try {
        if (frame.finish) {
          border(target, node);
          target.restore();
          assertSurface(target);
          if (frame.layer) {
            const layer = frame.layer;
            layer.destination.save();
            layer.destination.globalAlpha = node.module.style.opacity;
            layer.destination.drawImage(layer.canvas, layer.x, layer.y);
            layer.destination.restore();
            layer.canvas.width = 0;
            layer.canvas.height = 0;
            layers.delete(layer.canvas);
          }
          continue;
        }
        if (
          node.box.width <= 0 ||
          node.box.height <= 0 ||
          node.module.style.opacity === 0
        ) {
          continue;
        }
        let layer: Layer | undefined;
        if (node.module.style.opacity < 1) {
          const x = Math.floor(node.box.x);
          const y = Math.floor(node.box.y);
          const surface = createSurface(
            Math.ceil(node.box.x + node.box.width) - x,
            Math.ceil(node.box.y + node.box.height) - y,
          );
          layer = { canvas: surface.canvas, destination: target, x, y };
          layers.add(surface.canvas);
          target = surface.context;
          target.translate(-x, -y);
        }
        target.save();
        target.beginPath();
        roundedPath(target, node.box, node.radius);
        target.clip();
        background(target, node, resources);
        if (
          node.contentBox &&
          node.contentBox.width > 0 &&
          node.contentBox.height > 0
        ) {
          target.save();
          target.beginPath();
          target.rect(
            node.contentBox.x,
            node.contentBox.y,
            node.contentBox.width,
            node.contentBox.height,
          );
          target.clip();
          if (node.module.type === "image") {
            fittedImage(
              target,
              resources.images.get(node.module)!,
              node.contentBox,
              node.module.fit,
              node.module.style.align,
              node.module.style.verticalAlign,
            );
          } else if (node.module.type === "text") {
            drawText(
              target,
              node.module,
              node.contentBox,
              resources.fonts.get(node.module)!,
              control,
            );
          }
          target.restore();
        }
        pending.push({ node, context: target, finish: true, layer });
        for (let i = node.children.length - 1; i >= 0; i--) {
          pending.push({ node: node.children[i], context: target });
        }
      } catch (error) {
        throw located(error, { moduleId: node.moduleId, path: node.path });
      }
    }
    assertSurface(context);
  } finally {
    for (const layer of layers) {
      layer.width = 0;
      layer.height = 0;
    }
  }
}
