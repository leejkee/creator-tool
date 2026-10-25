# TypeScript 图片处理工具

入口：`desktop/src/image-tools/index.ts`。这些是无状态函数，不依赖 Vue、Tauri 命令、JSON 文档或会话；每次返回独立的 HTMLCanvasElement，不修改输入像素或尺寸。函数不加载文件、不保存文件、不添加页面节点，也不维护缓存。

## 输入与输出

输入为已经加载/解码的 HTMLImageElement、HTMLCanvasElement、ImageBitmap 或 OffscreenCanvas。图片元素使用 naturalWidth/naturalHeight，而非 CSS 显示尺寸。空图片、未加载图片和已关闭的 ImageBitmap 会被拒绝。

运行需要 WebView/浏览器的 document 和 Canvas 2D API；普通 Node.js 和没有 document 的 Worker 不属于当前执行环境。接受 OffscreenCanvas 作为输入，不代表函数在 Worker 内运行。输出画布保持透明背景，可继续作为下一次操作的输入，或交给后续合成/PNG 导出流程。

## 图片处理操作

```ts
import { blurImage, cropRectangle, cropCircle, scaleImage } from "../image-tools";

// 从原图的 (x, y) 取给定宽高，输出 200×120。
const rectangular = cropRectangle(source, { x: 20, y: 10, width: 200, height: 120 });

// 以原图坐标 (100, 80) 为圆心，半径 50，输出 100×100，圆外透明。
const circular = cropCircle(source, { centerX: 100, centerY: 80, radius: 50 });

// 宽高同时乘以比例；1 为复制，0.5 为缩小，2 为放大。
const smaller = scaleImage(source, 0.5);
const larger = scaleImage(source, 2);

// 所有返回值都是新的画布，可串联。
const result = scaleImage(cropCircle(rectangular, { centerX: 100, centerY: 60, radius: 40 }), 2);

// 整张图片模糊，blurRadius 为模糊强度（像素）。
const frosted = blurImage(source, { blurRadius: 12 });

// 原图坐标中的指定圆内保持清晰，圆外模糊。
const focused = blurImage(source, {
  blurRadius: 12,
  clearCircle: { centerX: 240, centerY: 224, radius: 128 },
});
```

| 操作 | 参数与边界 | 输出 |
| --- | --- | --- |
| cropRectangle | x/y 为有限非负原图坐标，可为小数；width/height 为正整数；整个矩形必须位于原图内 | width×height，保持所选像素区域，不自动缩放或截断越界参数 |
| cropCircle | centerX/centerY 为有限非负原图坐标，可为小数；radius 为有限正数；圆的左、上、右、下边界都必须位于原图内 | 边长 ceil(2×radius) 的方形 Canvas，圆外 alpha 为 0；小数直径产生不足 1 像素的透明余量 |
| scaleImage | ratio 为有限正数，宽高使用同一比例 | 各边 round(原尺寸×ratio)，最小为 1 像素；采用高质量平滑重采样 |
| blurImage | blurRadius 为有限非负数；clearCircle 可省略，提供时沿用圆心/半径与越界校验 | 原图尺寸；整图模糊或圆内原图清晰、圆外模糊；0 强度返回独立副本 |

圆形裁剪只平移原图，不改变其比例和像素尺寸；它不使用仅影响界面外观的 CSS 圆角。缩放取整不可避免地会在很小尺寸上造成比例近似。本阶段缩放仅支持等比例，尚无独立横纵比例、旋转或文档节点编辑。

## 错误

可捕获导出的 ImageProcessingError，读取 code/message：

- INVALID_IMAGE_SOURCE：输入没有可用的已解码像素。
- INVALID_IMAGE_ARGUMENT：坐标、尺寸、半径或比例参数非法。
- CROP_OUT_OF_BOUNDS：矩形越界或指定圆超出原图范围。
- INVALID_OUTPUT_SIZE：输出尺寸不是可表示的 Canvas 整数尺寸。
- CANVAS_UNAVAILABLE：缺少 Web Canvas 环境或无法取得有效 2D 上下文。
- FILTER_UNAVAILABLE：WebView 不支持或无法设置 Canvas 2D 模糊滤镜；不静默返回未模糊结果。

浏览器原生的资源、内存及跨源限制仍然有效；画布实际最大尺寸取决于 WebView。函数不绕过 Canvas 的跨源限制；后续资源加载层应提供允许导出像素的图片。

## 验证范围

`cd desktop && npm run build` 进行类型检查和前端构建。初版另使用仓库外的临时页面在 Chromium 中完成 40 项功能检查，覆盖像素、透明度、缩放尺寸、组合操作、不同输入类型、绘图状态恢复、源数据保持不变及非法参数，全部通过；没有向仓库新增测试代码或测试依赖。系统 WebView 上的最终接入留待后续阶段验证。

实际素材演示见 [tmp/image-tools-demo](../tmp/image-tools-demo/README.md)：使用仓库安琪拉图片直接调用四个工具，六张 PNG 已保存，20 项实图检查通过；可用 Node 和 Chromium 重复生成，不依赖 Vue 或 Tauri 运行。

圆形裁剪现在要求显式传入 `CropCircle {centerX, centerY, radius}`，不再接受单个半径参数。圆心和半径不能是 NaN、Infinity 或缺失字段，半径不能为零或负数。圆周恰好触及边界允许；任何方向越界都报 CROP_OUT_OF_BOUNDS，不自动调整圆心或半径。

本次指定圆心接口在 Chromium 中另通过 43 项圆形专项检查，覆盖偏离图片中心的实际取样、小数坐标/半径、四侧触边与越界、参数缺失/类型错误/非有限值、输出透明度和绘图状态恢复；安琪拉实图示例的 13 项检查也已重新通过。

## 毛玻璃模式

blurImage 使用 Canvas 2D 的 Gaussian blur 滤镜，不添加白色蒙层、噪点或额外透明度。blurRadius 是像素单位的高斯标准差，越大越模糊，允许零。该函数不裁剪或缩放图片；clearCircle 指定原图坐标中的清晰区域，输出仍为整张图片。

模糊前延展边缘像素，以免不透明图片边缘被模糊成透明；有透明内容的输入仍可保留透明度。圆形清晰区从原图恢复，并正确处理透明源像素与抗锯齿边界，避免残留模糊内容或透明接缝。输出的 filter、混合模式和剪裁状态均恢复，源图保持不变。

需要支持 CanvasRenderingContext2D.filter 的 WebView。此阶段没有软件模糊备用实现；不支持时显式返回 FILTER_UNAVAILABLE。blurRadius=0 无需滤镜支持，但仍校验 clearCircle。填充画布的实际尺寸仍受浏览器限制。

模糊模式在 Chromium 中通过 41 项专项检查，覆盖高对比边缘扩散、清晰区精确像素、圆外模糊、边缘及圆周 alpha、透明输入、零强度、滤镜不支持时的报错与参数合法性；安琪拉示例的 20 项实图检查也通过。

## 文件组织与扩展

每个工具单独存放，调用方统一从 index.ts 导入：

```text
desktop/src/image-tools/
├── crop-rectangle.ts  # 矩形裁剪
├── crop-circle.ts     # 指定圆心裁剪
├── scale-image.ts     # 等比例缩放
├── blur.ts            # 整图/圆外模糊
├── canvas.ts          # 画布创建、尺寸及公共几何校验
├── errors.ts          # 统一错误
├── types.ts           # 共享输入及参数类型
└── index.ts           # 公共导出入口
```

新增操作时添加一个 TS 文件，再在 index.ts 导出该函数和必要类型；无需修改现有工具或注册运行时插件。新操作应继续消费已解码 ImageSource、返回新画布、复用公共校验，并自行恢复绘图状态。调用方可直接将输出交给下一个工具。
