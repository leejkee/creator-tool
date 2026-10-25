# 上图下文 Style 示例

- [style.json](style.json)：两行一列，上方图片，下方文字；不携带素材、文本或目标 ID。
- [image.json](image.json)：应用前的实际图片文档，使用已有安琪拉图片和文字。
- [applied.image.json](applied.image.json)：调用 Rust apply_style 后的完整文档；所有参数已展开，不再依赖 Style 文件。
- [square-focus.ts](square-focus.ts)：处理函数，组合已有 TS 裁剪和模糊工具。
- [process-image.ts](process-image.ts)：将 JSON 中的 square-focus.process 精确映射到 TS 函数，并按调用数组顺序执行图片处理链。
- [processed.png](processed.png)：实际浏览器 Canvas 执行脚本后的 544×544 图片，保留原始处理分辨率；不是包含文字的整图导出。
- [processing-result.json](processing-result.json)：75 项浏览器检查结果，包含像素效果、多参数顺序、内置映射、异步顺序、错误定位、输入保护及旧格式拒绝。

图片模块显示为 320×320，文字区域同宽，28px、居中、加粗。group 的 layout=[2,1]，图片位于 [0,0]，文字位于 [1,0]。尺寸及文字排版声明留待完整 Engine 渲染；当前没有生成整张排版 PNG。

处理脚本先基于输入素材的实际像素尺寸居中裁剪最大正方形，再以中心为圆心、边长一半为半径保留清晰内切圆，四角作高斯模糊。clearRadiusRatio 的范围为 (0,0.5]，0.5 表示内切圆；blurRadius=12 表示裁剪后图片像素中的模糊半径，0 表示不模糊。裁剪坐标和圆参数由脚本根据实际输入计算，适用于横图、竖图和正方形，不需要在 JSON 中硬编码素材尺寸。

## Engine 调用约定

图片模块的 processors 数组依次执行，每一步读取上一步输出，处理完成后再由布局层应用 width/height/fit。Rust 校验和存储声明，不执行 TS，也不会将注册标识作为文件路径读取。脚本自检具体参数。

```json
"processors": [
  ["square-focus.process", 12, 0.5]
]
```

当前可通过注册表显式导入并调用：

```ts
import { createBuiltinProcessorRegistry, runImageProcessors } from "../../desktop/src/image-processors";
import { process } from "./square-focus";

const registry = createBuiltinProcessorRegistry([
  ["square-focus.process", process],
]);
const output = await runImageProcessors(decodedImage, imageModule.processors ?? [], registry);
```

每项先写完整函数标识，随后按顺序写参数。执行器自动传入当前图片，上述调用等价于 `process(image, 12, 0.5)`。此函数允许 0–2 个参数，省略时使用默认值，显式 null 作为非法数值拒绝。注册表按完整标识精确查找，函数标识中的点号没有路径或动态加载语义。旧 `{script,function,params}` 格式已替换并拒绝。

内置函数标识为 image-tools.cropRectangle / cropCircle / scaleImage / blurImage，每个要求恰好一个额外参数：scaleImage 是比例数值，其余是工具参数对象。未知标识和执行失败返回包含 functionId/stepIndex 的错误。接口见 [处理函数映射与执行](../../docs/tauri-image-processors.md)；素材读取、布局及整图合成仍由后续 Engine 接入。

Style 应用会整体替换目标图片的 processors；遗漏或空数组会清除旧链。素材引用和实际文字仍来自 image.json。Style 应用发生一次；每次合成图片时，Engine 才会对素材执行已展开的 processors。请勿将新 TS 声明交给旧 Python/Pillow 脚本系统执行。

已通过真实 Rust 调用生成 applied.image.json，55 项检查覆盖调用数组、替换/清除、内容保留、序列化往返、补丁编辑、会话提交及版本保护。浏览器读取 applied.image.json，通过 processImageModule 完成函数映射及图片处理，75 项检查通过。验证程序放在系统临时目录，本目录只保留示例资源与结果，未新增仓库测试代码。
