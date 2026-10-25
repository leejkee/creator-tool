# 图片处理函数映射与执行

JSON 统一用 `[函数标识, ...参数]` 表示一次调用。TS 使用显式导入的函数建立注册表，执行器将当前图片作为隐含的第一个参数，按顺序调用。实现位于 `desktop/src/image-processors/`，不需要 Node.js 或 Rust 运行 TS。

## 注册与调用

```ts
import { createBuiltinProcessorRegistry, runImageProcessors } from "./image-processors";
import { process } from "./scripts/square-focus"; // 调用者实际导入的 TS 模块

const registry = createBuiltinProcessorRegistry([
  ["square-focus.process", process],
]);

const output = await runImageProcessors(
  decodedImage,
  imageModule.processors ?? [],
  registry,
);
```

上述示例中的脚本导入路径由调用者决定；仓库可运行的具体接线见 [process-image.ts](../tmp/style-image-caption/process-image.ts)，它使用真实 [square-focus.ts](../tmp/style-image-caption/square-focus.ts)。

```json
["square-focus.process", 12, 0.5]
```

这条声明精确映射到注册项的 process 函数，等价于 `process(image, 12, 0.5)`。函数标识建议使用 `模块.函数` 命名，整体作为不透明字符串精确查找，区分大小写，不解析其中的点号，不做路径猜测、隐式改名或名称裁剪。新增函数时新增 TS 文件，再增加一条注册记录；同一模块可以注册不同标识的多个入口。

`createProcessorRegistry(registrations)` 接收 `[函数标识, 实际函数]` 注册对列表；`createBuiltinProcessorRegistry(extraFunctions?)` 附带内置工具并接收自定义注册对。创建时复制映射，之后只提供 `resolve(functionId)` 查询，无注册修改操作或可变全局注册表。重复函数标识拒绝，禁止覆盖已注册函数。使用 Map 精确查找，toString 等继承成员不会自动暴露。

## 内置映射

| 函数标识 | 标识后的参数 |
| --- | --- |
| image-tools.cropRectangle | 一个对象：{x,y,width,height} |
| image-tools.cropCircle | 一个对象：{centerX,centerY,radius} |
| image-tools.scaleImage | 一个数值：ratio |
| image-tools.blurImage | 一个对象：{blurRadius,clearCircle?}，clearCircle={centerX,centerY,radius} |

这些内置函数均要求恰好一个参数，参数适配器检查数量和类型，数值范围及边界由原有工具检查。裁剪和模糊坐标均相对于当前步骤的输入，不一定是原始素材。所有工具继续使用原有 Canvas 实现，原有直接调用 API 保持原样。自定义函数可以接收零个或多个参数，由自身检查数量、类型及范围。

```json
[
  ["image-tools.cropRectangle", {"x": 32, "y": 48, "width": 352, "height": 384}],
  ["image-tools.scaleImage", 0.5]
]
```

此链先裁剪为 352×384，再缩放为 176×192；执行完成后才由后续布局层适配模块显示大小。

## 执行契约

- 入口类型为 `(ImageSource, ...JsonValue[]) => ImageSource | Promise<ImageSource>`。执行器解构每项后执行 `handler(image, ...args)`；`["module.function"]` 表示不传额外参数，不自动补空对象。
- 函数标识为非空字符串，后续参数可以是数值、字符串、布尔值、null、对象或数组，顺序保留。缺少参数与显式 null 不同；Rust 不递归解释参数中的节点字段名。
- 先检查整个数组的声明并解析所有入口，同时复制参数。某个标识缺失时不执行任何步骤；异步运行期间外部修改声明或参数不会改变已准备的调用。
- 每次执行先复制输入图像，脚本处理独立图像；每个步骤接收上一项结果，await 完成后才进入下一项。即使脚本就地修改后抛出异常，调用者的原图和参数仍保留。
- 每一步输出必须为有效、非空、已解码的 Canvas 可绘制图像。失败立即停止，后续步骤不运行，不返回部分结果。成功返回最后一步的图像；空链也返回独立副本。
- Rust 继续负责声明结构和文档状态；TS 注册表负责实际入口查找，具体参数范围由函数检查。不根据 JSON 字符串动态加载文件，也不将字符串作为代码执行。

## 错误与范围

ImageProcessorError 含 code、message、context 和 cause。context 带 functionId/stepIndex，stepIndex 从 0 开始；格式错误尚无法取得有效标识时至少提供索引。cause 保留原始工具或脚本错误，供 Engine 展示或诊断。

| code | 含义 |
| --- | --- |
| INVALID_PROCESSOR_REGISTRATION | 注册标识或函数映射不合法 |
| DUPLICATE_PROCESSOR_FUNCTION | 函数标识重复注册 |
| INVALID_PROCESSOR_DECLARATION | processors/调用数组不合法或参数无法复制 |
| PROCESSOR_FUNCTION_NOT_FOUND | 函数标识未注册 |
| PROCESSOR_EXECUTION_FAILED | 函数抛错或异步拒绝，cause 保留原始错误 |
| INVALID_PROCESSOR_OUTPUT | 输出不是支持的图像或尺寸无效 |

当前仅实现图片处理链，不负责素材读取、字体、文字布局、整图合成和 PNG 导出流程。处理函数运行在 WebView/浏览器 Canvas 环境中；尚未在实际 Tauri WebView 验收。

不接受本分支早期的 `{script,function,params}` 对象格式，不进行隐式转换。图片和 Style 使用相同调用数组，Rust 序列化与反序列化、普通节点补丁和 TS 执行器都遵循这一格式。

验证通过：现有 68 个 Rust 测试、Rust/Tauri Clippy、TypeScript/Vite 构建、临时示例类型检查，以及仓库外 55 项 Rust 检查和 75 项浏览器检查。覆盖调用数组往返、Style 应用、补丁编辑、参数顺序、内置映射与直接调用逐像素一致、异步顺序、未知/重复标识、旧格式拒绝、参数复制、失败隔离和输出校验。浏览器结果见 [processing-result.json](../tmp/style-image-caption/processing-result.json)，未新增仓库测试代码。
