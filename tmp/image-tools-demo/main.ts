import { cropCircle, cropRectangle, scaleImage } from "../../desktop/src/image-tools";

interface DemoImage {
  readonly fileName: string;
  readonly operation: string;
  readonly parameters: Readonly<Record<string, number>>;
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
  const circle = cropCircle(source, 240);
  const smaller = scaleImage(source, 0.5);
  const larger = scaleImage(source, 2);
  check("矩形输出尺寸", rectangle.width === 352 && rectangle.height === 384);
  check("圆形输出尺寸", circle.width === 480 && circle.height === 480);
  check("缩小输出尺寸", smaller.width === 272 && smaller.height === 272);
  check("放大输出尺寸", larger.width === 1088 && larger.height === 1088);
  const circleContext = circle.getContext("2d")!;
  for (const [x, y] of [[0, 0], [479, 0], [0, 479], [479, 479]]) {
    check(`圆外透明 ${x},${y}`, circleContext.getImageData(x, y, 1, 1).data[3] === 0);
  }
  check("圆内保留图像", circleContext.getImageData(240, 240, 1, 1).data[3] === 255);
  const cropPixels = rectangle.getContext("2d")!.getImageData(0, 0, 352, 384).data;
  const expectedPixels = original.getContext("2d")!.getImageData(96, 32, 352, 384).data;
  check("矩形像素与原图区域一致", cropPixels.every((value, index) => value === expectedPixels[index]));
  original.getContext("2d")!.clearRect(0, 0, width, height);
  original.getContext("2d")!.drawImage(source, 0, 0);
  const after = original.getContext("2d")!.getImageData(0, 0, width, height).data;
  check("输入像素未修改", before.every((value, index) => value === after[index]));
  const outputs = [
    { fileName: "rectangle.png", operation: "cropRectangle", parameters: { x: 96, y: 32, width: 352, height: 384 }, canvas: rectangle },
    { fileName: "circle.png", operation: "cropCircle", parameters: { radius: 240 }, canvas: circle },
    { fileName: "scale-half.png", operation: "scaleImage", parameters: { ratio: 0.5 }, canvas: smaller },
    { fileName: "scale-double.png", operation: "scaleImage", parameters: { ratio: 2 }, canvas: larger },
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
