export interface PngFramePlacement {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

interface Chunk {
  readonly type: string;
  readonly data: Uint8Array;
  readonly bytes: Uint8Array;
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(new TextEncoder().encode(type), 4);
  result.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < result.length - 4; i++) {
    crc ^= result[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}

/** APNG can have a poster unrelated to frame zero; never silently return that poster. */
export function preparePng(bytes: Uint8Array): {
  bytes: Uint8Array;
  frame?: PngFramePlacement;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) {
      throw new Error("PNG 块长度无效");
    }
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type !== "eXIf") {
      chunks.push({
        type,
        data: bytes.subarray(offset + 8, end - 4),
        bytes: bytes.subarray(offset, end),
      });
    }
    offset = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || chunks[0]?.type !== "IHDR" || chunks[0].data.length !== 13) {
    throw new Error("PNG 数据不完整");
  }
  const signature = bytes.subarray(0, 8);
  const firstControl = chunks.findIndex((item) => item.type === "fcTL");
  const firstData = chunks.findIndex((item) => item.type === "IDAT");
  const animated = chunks.some((item) => item.type === "acTL");
  if (
    !animated ||
    firstControl < 0 ||
    firstData < 0 ||
    firstControl < firstData
  ) {
    return { bytes: join([signature, ...chunks.map((item) => item.bytes)]) };
  }
  const control = chunks[firstControl].data;
  if (control.length !== 26) {
    throw new Error("APNG 首帧控制数据无效");
  }
  const fields = new DataView(
    control.buffer,
    control.byteOffset,
    control.byteLength,
  );
  const header = chunks[0].data.slice();
  const headerView = new DataView(header.buffer);
  const frame: PngFramePlacement = {
    width: fields.getUint32(4),
    height: fields.getUint32(8),
    x: fields.getUint32(12),
    y: fields.getUint32(16),
    canvasWidth: headerView.getUint32(0),
    canvasHeight: headerView.getUint32(4),
  };
  if (
    frame.width === 0 ||
    frame.height === 0 ||
    frame.x + frame.width > frame.canvasWidth ||
    frame.y + frame.height > frame.canvasHeight
  ) {
    throw new Error("APNG 首帧超出动画画布");
  }
  headerView.setUint32(0, frame.width);
  headerView.setUint32(4, frame.height);
  const parts = [signature, chunk("IHDR", header)];
  for (const item of chunks.slice(1, firstData)) {
    if (item.type !== "acTL" && item.type !== "fcTL") {
      parts.push(item.bytes);
    }
  }
  let frameChunks = 0;
  for (const item of chunks.slice(firstControl + 1)) {
    if (item.type === "fcTL" || item.type === "IEND") {
      break;
    }
    if (item.type === "fdAT") {
      if (item.data.length < 4) {
        throw new Error("APNG 首帧像素数据无效");
      }
      parts.push(chunk("IDAT", item.data.subarray(4)));
      frameChunks++;
    }
  }
  if (frameChunks === 0) {
    throw new Error("APNG 缺少首帧像素数据");
  }
  parts.push(chunk("IEND", new Uint8Array()));
  return { bytes: join(parts), frame };
}
