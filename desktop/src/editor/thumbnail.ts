import type { PreviewView } from "./contracts";

/** Save a smaller complete frame; never modify the Engine's original canvas. */
export function thumbnailDataUrl(frame: PreviewView): string {
  const scale = Math.min(1, 320 / Math.max(frame.width, frame.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(frame.width * scale));
  canvas.height = Math.max(1, Math.round(frame.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("无法创建缩略图画布");
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(frame.surface, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
