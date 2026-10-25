import { blurImage, cropCircle, cropRectangle, scaleImage } from "../../desktop/src/image-tools";

interface DemoImage {
  readonly fileName: string;
  readonly operation: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly width: number;
  readonly height: number;
  readonly pngDataUrl: string;
}
interface DemoResult {
  readonly status: "passed" | "failed";
  readonly error?: string;
  readonly input?: { readonly width: number; readonly height: number };
  readonly checks?: readonly string[];
  readonly images?: readonly DemoImage[];
}
const state = window as Window & { imageToolsDemo?: DemoResult };

function show(label: string, image: HTMLImageElement | HTMLCanvasElement): void {
  const figure = document.createElement("figure");
  const caption = document.createElement("figcaption");
  caption.textContent = label;
  figure.append(image, caption);
  document.querySelector("#gallery")!.append(figure);
}

async function main(): Promise<void> {
  const source = new Image();
  source.src = new URL("./original.png", import.meta.url).href;
  await source.decode();
  show("原图 544×544", source);
  const width = source.naturalWidth;
  const height = source.naturalHeight;
  const original = document.createElement("canvas");
  original.width = width;
  original.height = height;
  original.getContext("2d")!.drawImage(source, 0, 0);
  const before = original.getContext("2d")!.getImageData(0, 0, width, height).data;
  const checks: string[] = [];
  const check = (label: string, valid: boolean): void => {
    if (!valid) throw new Error(label);
    checks.push(label);
  };
  check("原图尺寸", width === 544 && height === 544);
  const rectangle = cropRectangle(source, { x: 96, y: 32, width: 352, height: 384 });
  const circle = cropCircle(source, { centerX: 240, centerY: 224, radius: 192 });
  const smaller = scaleImage(source, 0.5);
  const larger = scaleImage(source, 2);
  const blurred = blurImage(source, { blurRadius: 12 });
  const focused = blurImage(source, {
    blurRadius: 12,
    clearCircle: { centerX: 240, centerY: 224, radius: 128 },
  });
  check("矩形输出尺寸", rectangle.width === 352 && rectangle.height === 384);
  check("圆形输出尺寸", circle.width === 384 && circle.height === 384);
  check("缩小输出尺寸", smaller.width === 272 && smaller.height === 272);
  check("放大输出尺寸", larger.width === 1088 && larger.height === 1088);
  check("整图模糊尺寸不变", blurred.width === width && blurred.height === height);
  check("圆内清晰模式尺寸不变", focused.width === width && focused.height === height);
  const blurredPixels = blurred.getContext("2d")!.getImageData(0, 0, width, height).data;
  const focusedPixels = focused.getContext("2d")!.getImageData(0, 0, width, height).data;
  check("整图产生模糊效果", blurredPixels.some((value, index) => value !== before[index]));
  const centerOffset = (224 * width + 240) * 4;
  check("指定圆心保持原图清晰像素", focusedPixels.slice(centerOffset, centerOffset + 4).every((value, index) => value === before[centerOffset + index]));
  check("圆外使用模糊像素", focusedPixels.slice(0, 4).every((value, index) => value === blurredPixels[index]));
  check("模糊不产生透明边缘", blurredPixels.every((value, index) => index % 4 !== 3 || value === 255));
  check("清晰圆周不产生透明接缝", focusedPixels.every((value, index) => index % 4 !== 3 || value === 255));
  const circleContext = circle.getContext("2d")!;
  for (const [x, y] of [[0, 0], [383, 0], [0, 383], [383, 383]]) {
    check(`圆外透明 ${x},${y}`, circleContext.getImageData(x, y, 1, 1).data[3] === 0);
  }
  check("圆内保留图像", circleContext.getImageData(192, 192, 1, 1).data[3] === 255);
  const circleCenter = circleContext.getImageData(192, 192, 1, 1).data;
  const sourceCenter = original.getContext("2d")!.getImageData(240, 224, 1, 1).data;
  check("圆心对应指定原图坐标", circleCenter.every((value, index) => value === sourceCenter[index]));
  const cropPixels = rectangle.getContext("2d")!.getImageData(0, 0, 352, 384).data;
  const expectedPixels = original.getContext("2d")!.getImageData(96, 32, 352, 384).data;
  check("矩形像素与原图区域一致", cropPixels.every((value, index) => value === expectedPixels[index]));
  original.getContext("2d")!.clearRect(0, 0, width, height);
  original.getContext("2d")!.drawImage(source, 0, 0);
  const after = original.getContext("2d")!.getImageData(0, 0, width, height).data;
  check("输入像素未修改", before.every((value, index) => value === after[index]));
  const outputs = [
    { fileName: "rectangle.png", operation: "cropRectangle", parameters: { x: 96, y: 32, width: 352, height: 384 }, canvas: rectangle },
    { fileName: "circle.png", operation: "cropCircle", parameters: { centerX: 240, centerY: 224, radius: 192 }, canvas: circle },
    { fileName: "scale-half.png", operation: "scaleImage", parameters: { ratio: 0.5 }, canvas: smaller },
    { fileName: "scale-double.png", operation: "scaleImage", parameters: { ratio: 2 }, canvas: larger },
    { fileName: "blur.png", operation: "blurImage", parameters: { blurRadius: 12 }, canvas: blurred },
    { fileName: "blur-clear-circle.png", operation: "blurImage", parameters: { blurRadius: 12, clearCircle: { centerX: 240, centerY: 224, radius: 128 } }, canvas: focused },
  ] as const;
  const images: DemoImage[] = outputs.map(({ fileName, operation, parameters, canvas }) => {
    show(`${fileName} ${canvas.width}×${canvas.height}`, canvas);
    return { fileName, operation, parameters, width: canvas.width, height: canvas.height, pngDataUrl: canvas.toDataURL("image/png") };
  });
  state.imageToolsDemo = { status: "passed", input: { width, height }, checks, images };
  document.querySelector("#status")!.textContent = `完成：${checks.length} 项检查通过，生成 ${images.length} 张图片。`;
}
main().catch((error: unknown) => {
  state.imageToolsDemo = { status: "failed", error: String(error) };
  document.querySelector("#status")!.textContent = String(error);
});
