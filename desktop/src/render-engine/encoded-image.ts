import { preparePng } from "./png-source";
import type { PngFramePlacement } from "./png-source";

interface PreparedRaster {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly frame?: PngFramePlacement;
}

function fourCC(bytes: Uint8Array, start: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + 4));
}

function joined(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function jpegWithoutExif(bytes: Uint8Array): Uint8Array {
  const parts = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 0xff) {
      throw new Error("JPEG 标记无效");
    }
    while (bytes[offset] === 0xff) {
      offset++;
    }
    const marker = bytes[offset++];
    if (marker === undefined) {
      throw new Error("JPEG 数据不完整");
    }
    if (marker === 0xda || marker === 0xd9) {
      parts.push(bytes.subarray(start));
      return joined(parts);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(start, offset));
      continue;
    }
    const length = bytes[offset] * 256 + bytes[offset + 1];
    const end = offset + length;
    if (!Number.isInteger(length) || length < 2 || end > bytes.length) {
      throw new Error("JPEG 段长度无效");
    }
    const isExif =
      marker === 0xe1 &&
      length >= 8 &&
      fourCC(bytes, offset + 2) === "Exif" &&
      bytes[offset + 6] === 0 &&
      bytes[offset + 7] === 0;
    if (!isExif) {
      parts.push(bytes.subarray(start, end));
    }
    offset = end;
  }
  throw new Error("JPEG 缺少图像数据");
}

function webpWithoutExif(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = view.getUint32(4, true) + 8;
  if (end > bytes.length || end < 12) {
    throw new Error("WebP 容器长度无效");
  }
  const parts = [bytes.slice(0, 12)];
  let offset = 12;
  while (offset + 8 <= end) {
    const type = fourCC(bytes, offset);
    const length = view.getUint32(offset + 4, true);
    const next = offset + 8 + length + (length % 2);
    if (next > end) {
      throw new Error("WebP 块长度无效");
    }
    if (type !== "EXIF") {
      const chunk = bytes.slice(offset, next);
      if (type === "VP8X") {
        if (length !== 10) {
          throw new Error("WebP 扩展头无效");
        }
        chunk[8] &= ~0x08;
      }
      parts.push(chunk);
    }
    offset = next;
  }
  if (offset !== end) {
    throw new Error("WebP 数据不完整");
  }
  const result = joined(parts);
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return result;
}

function raster(bytes: Uint8Array): PreparedRaster | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { bytes: jpegWithoutExif(bytes), mime: "image/jpeg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    fourCC(bytes, 1) === "PNG\r" &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  ) {
    return { ...preparePng(bytes), mime: "image/png" };
  }
  if (
    bytes.length >= 12 &&
    fourCC(bytes, 0) === "RIFF" &&
    fourCC(bytes, 8) === "WEBP"
  ) {
    return { bytes: webpWithoutExif(bytes), mime: "image/webp" };
  }
  return undefined;
}

function reference(value: string): string {
  const ref = value.trim();
  if (ref.startsWith("#")) {
    return ref;
  }
  const embedded =
    /^data:image\/(?:png|jpeg|webp);base64,([a-z\d+/=\s]+)$/i.exec(ref);
  if (embedded) {
    const binary = atob(embedded[1].replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const image = raster(bytes);
    if (!image) {
      throw new Error("SVG 内嵌图片不是受支持的位图");
    }
    let encoded = "";
    for (let i = 0; i < image.bytes.length; i += 8192) {
      encoded += String.fromCharCode(...image.bytes.subarray(i, i + 8192));
    }
    const uri = `data:${image.mime};base64,${btoa(encoded)}`;
    if (image.frame) {
      const frame = image.frame;
      const wrapper = `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.canvasWidth}" height="${frame.canvasHeight}"><image x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" href="${uri}"/></svg>`;
      return `data:image/svg+xml;base64,${btoa(wrapper)}`;
    }
    return uri;
  }
  throw new Error("SVG 只能引用自身片段或内嵌 PNG、JPEG、WebP，不加载外部依赖");
}

function css(value: string): string {
  const content = value.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/[\\@]/.test(content)) {
    throw new Error("SVG 不接受转义或外部样式、字体声明");
  }
  return content.replace(
    /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
    (_match, _quote: string, url: string) =>
      `url(${JSON.stringify(reference(url))})`,
  );
}

function svgLength(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const match = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*(px|in|cm|mm|pt|pc|q)?\s*$/i.exec(
    value,
  );
  if (!match) {
    return undefined;
  }
  const units: Record<string, number> = {
    px: 1,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    pt: 96 / 72,
    pc: 16,
    q: 96 / 101.6,
  };
  const result = Number(match[1]) * units[(match[2] ?? "px").toLowerCase()];
  if (!Number.isFinite(result) || result <= 0) {
    throw new Error("SVG 固有尺寸必须为正数");
  }
  return result;
}

function svgBytes(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) {
    throw new Error("SVG 必须是没有外部文档或样式依赖的自包含图片");
  }
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.documentElement;
  if (
    doc.querySelector("parsererror") ||
    svg.localName !== "svg" ||
    svg.namespaceURI !== "http://www.w3.org/2000/svg"
  ) {
    throw new Error("素材不是有效的 PNG、JPEG、WebP 或 SVG");
  }
  const forbidden = new Set([
    "script",
    "foreignobject",
    "iframe",
    "object",
    "embed",
    "audio",
    "video",
  ]);
  for (const element of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    if (forbidden.has(element.localName.toLowerCase())) {
      throw new Error("SVG 包含不受支持的脚本或嵌入内容");
    }
    for (const attribute of Array.from(element.attributes)) {
      if (
        attribute.localName === "base" &&
        attribute.namespaceURI === "http://www.w3.org/XML/1998/namespace" &&
        attribute.value.trim() !== ""
      ) {
        throw new Error("SVG 不能修改资源解析基址");
      }
      if (attribute.localName.toLowerCase().startsWith("on")) {
        throw new Error("SVG 不执行事件脚本");
      }
      if (attribute.localName === "href" || attribute.localName === "src") {
        attribute.value = reference(attribute.value);
      } else if (
        /url\s*\(/i.test(attribute.value) ||
        attribute.localName === "style"
      ) {
        attribute.value = css(attribute.value);
      }
    }
    if (element.localName === "style") {
      element.textContent = css(element.textContent ?? "");
    }
  }
  const viewBox = (svg.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const hasViewBox =
    viewBox.length === 4 &&
    viewBox.every(Number.isFinite) &&
    viewBox[2] > 0 &&
    viewBox[3] > 0;
  let width = svgLength(svg.getAttribute("width"));
  let height = svgLength(svg.getAttribute("height"));
  if (hasViewBox) {
    if (width === undefined && height === undefined) {
      width = viewBox[2];
      height = viewBox[3];
    } else if (width === undefined) {
      width = (height! * viewBox[2]) / viewBox[3];
    } else if (height === undefined) {
      height = (width * viewBox[3]) / viewBox[2];
    }
  }
  width = Math.ceil(width ?? 300);
  height = Math.ceil(height ?? 150);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 0xffffffff ||
    height > 0xffffffff
  ) {
    throw new Error("SVG 固有尺寸不可用");
  }
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  return new TextEncoder().encode(new XMLSerializer().serializeToString(svg));
}

/** Remove orientation metadata before decoding so raw coordinates do not depend on EXIF handling. */
export function prepareEncodedImage(bytes: Uint8Array): {
  blob: Blob;
  frame?: PngFramePlacement;
} {
  const image = raster(bytes);
  const prepared: PreparedRaster = image ?? {
    bytes: svgBytes(bytes),
    mime: "image/svg+xml",
  };
  const owned = new Uint8Array(prepared.bytes.length);
  owned.set(prepared.bytes);
  return {
    blob: new Blob([owned.buffer], { type: prepared.mime }),
    frame: prepared.frame,
  };
}
