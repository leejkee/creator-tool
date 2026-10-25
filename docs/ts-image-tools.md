# TypeScript 图片处理工具

入口：`desktop/src/image-tools/index.ts`。这些是无状态函数，不依赖 Vue、Tauri 命令、JSON 文档或会话；每次返回独立的 HTMLCanvasElement，不修改输入像素或尺寸。函数不加载文件、不保存文件、不添加页面节点，也不维护缓存。

## 输入与输出

输入为已经加载/解码的 HTMLImageElement、HTMLCanvasElement、ImageBitmap 或 OffscreenCanvas。图片元素使用 naturalWidth/naturalHeight，而非 CSS 显示尺寸。空图片、未加载图片和已关闭的 ImageBitmap 会被拒绝。

运行需要 WebView/浏览器的 document 和 Canvas 2D API；普通 Node.js 和没有 document 的 Worker 不属于当前执行环境。接受 OffscreenCanvas 作为输入，不代表函数在 Worker 内运行。输出画布保持透明背景，可继续作为下一次操作的输入，或交给后续合成/PNG 导出流程。

## 三个操作

```ts
import { cropRectangle, cropCircle, scaleImage } from "../image-tools";

// 从原图的 (x, y) 取给定宽高，输出 200×120。
const rectangular = cropRectangle(source, { x: 20, y: 10, width: 200, height: 120 });

// 原图中心为圆心，半径 50，输出 100×100，圆外透明。
const circular = cropCircle(source, 50);

// 宽高同时乘以比例；1 为复制，0.5 为缩小，2 为放大。
const smaller = scaleImage(source, 0.5);
const larger = scaleImage(source, 2);

// 所有返回值都是新的画布，可串联。
const result = scaleImage(cropCircle(rectangular, 40), 2);
```

| 操作 | 参数与边界 | 输出 |
| --- | --- | --- |
| cropRectangle | x/y 为有限非负原图坐标，可为小数；width/height 为正整数；整个矩形必须位于原图内 | width×height，保持所选像素区域，不自动缩放或截断越界参数 |
| cropCircle | radius 为有限正数，不超过原图短边的一半；圆心固定为原图中心 | 边长 ceil(2×radius) 的方形 Canvas，圆外 alpha 为 0；小数直径产生不足 1 像素的透明余量 |
| scaleImage | ratio 为有限正数，宽高使用同一比例 | 各边 round(原尺寸×ratio)，最小为 1 像素；采用高质量平滑重采样 |

圆形裁剪只平移原图，不改变其比例和像素尺寸；它不使用仅影响界面外观的 CSS 圆角。缩放取整不可避免地会在很小尺寸上造成比例近似。本阶段仅提供等比例缩放，没有独立横纵比例、旋转、滤镜或文档节点编辑。

## 错误

可捕获导出的 ImageProcessingError，读取 code/message：

- INVALID_IMAGE_SOURCE：输入没有可用的已解码像素。
- INVALID_IMAGE_ARGUMENT：坐标、尺寸、半径或比例参数非法。
- CROP_OUT_OF_BOUNDS：矩形越界或圆半径超出短边限制。
- INVALID_OUTPUT_SIZE：输出尺寸不是可表示的 Canvas 整数尺寸。
- CANVAS_UNAVAILABLE：缺少 Web Canvas 环境或无法取得有效 2D 上下文。

浏览器原生的资源、内存及跨源限制仍然有效；画布实际最大尺寸取决于 WebView。函数不绕过 Canvas 的跨源限制；后续资源加载层应提供允许导出像素的图片。

## 验证范围

`cd desktop && npm run build` 进行类型检查和前端构建。另使用仓库外的临时页面在 Chromium 中完成 40 项功能检查，覆盖像素、透明度、缩放尺寸、组合操作、不同输入类型、绘图状态恢复、源数据保持不变及非法参数，全部通过；没有向仓库新增测试代码或测试依赖。系统 WebView 上的最终接入留待后续阶段验证。

实际素材演示见 [tmp/image-tools-demo](../tmp/image-tools-demo/README.md)：使用仓库安琪拉图片直接调用三个工具，四张 PNG 已保存，12 项实图检查通过；可用 Node 和 Chromium 重复生成，不依赖 Vue 或 Tauri 运行。
