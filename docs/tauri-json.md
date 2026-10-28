# Tauri 图片 JSON 协议 v0.2.0

本协议描述图片文档的预期结构。2026-10-26 起 Rust 已移除业务校验，仅保留 Serde 对现有结构的反序列化要求，不保证读入的文档符合下述渲染约定。Rust 不自动转换旧格式、猜测位置或覆盖旧文件。开发接口见 [Tauri 开发文档](tauri-dev.md)，完整示例见 [grid.image.json](../desktop/examples/grid.image.json)。

## 文档与模块

一份文档包含 `image-create-tool-version: "v0.2.0"`、非空 documentId、非负整数 revision、composition 对象和 modules 数组。文档的工作目录、dirty 和会话版本是 Rust 会话状态，不写入 JSON。

modules 保留数组格式，但新 TS 渲染规则要求且只允许一个根模块。根可以是叶子或 group；需要多个内容时，在根 group 的 children 中组织，不为多个根额外推导画布排列。Rust 仍可读写不满足该渲染约定的文档。

模块约定使用非空 id、type，type 为 text/image/rect/group，模块 ID 在文档内唯一，text 模块提供 text 字符串。Rust 当前只将 id/type 解码为字符串，不检查非空、枚举或唯一性，也不检查 text 内容。样式、素材引用和其他扩展字段随模块保存；elements、模块内的 position 及 span 也不再因业务规则被拒绝，但不会自动转换为现有网格结构。

## 本地素材引用（新 TS 方案）

新渲染方案统一使用 `assetPath` 引用用户准备好的本地图片文件，相对路径以图片 JSON 所在目录为基准，也支持绝对本地路径。素材准备由用户完成，应用只读取最终本地文件。普通图片与图片背景采用同一规则。

`assetId`、`assetQuery`、`assetsDir`、`assetAliases` 属于旧方案，Rust 仍可保留读写，但不表示新 TS 渲染层支持素材 ID、搜索或别名解析。旧样例使用这些字段时需要迁移。

路径输入检查入口为 `src/render-input/asset.ts` 的 `resolveLocalImagePath`；缺省或空白值返回 `undefined`，非法类型、NUL 或 URI 形式报错。目录解析、读取和解码尚未实现。完整约定见 [渲染参数校验文档](tauri-render-validation.md#本地素材引用)。

## 渲染默认值示例：图片 fit

渲染默认值由 `desktop/src/render-input/` 统一解析。`validateRenderDocument` 接受来自 Rust 的对象，校验参数后返回独立的只读渲染输入及警告；失败时返回字段错误并阻止渲染，不修改文档或回写 JSON。具体尺寸、样式、背景及默认值见 [渲染参数校验与布局规则](tauri-render-validation.md)。Rust 不承担 fit 等渲染参数的业务校验。

fit 表示图片如何缩放到模块内容区域。各取值的含义如下；对齐位置由布局层决定，fit 本身不表示居中。

| 取值 | 中文含义 | 效果 |
| --- | --- | --- |
| `"contain"`（默认） | 等比完整显示 | 整张图片放入区域内，不裁剪、不变形，比例不同时会留空 |
| `"cover"` | 等比铺满 | 图片覆盖整个区域，超出边界的部分需要裁剪 |
| `"stretch"` | 拉伸铺满 | 宽高分别适配区域，可能改变原图比例 |
| `"height"` | 高度适配 | 等比缩放至区域高度，宽度可能留空或超出 |
| `"width"` | 宽度适配 | 等比缩放至区域宽度，高度可能留空或超出 |

例如原图为 400×200，模块内容区域为 200×200：contain 得到 200×100，完整显示原图；若居中，上下各空出 50px，空余处显示背景或保持透明。cover 得到 400×200，若居中裁剪则左右各裁掉 100px；stretch 得到 200×200，原图被纵向拉伸。以上描述缩放语义，实际绘制尚待 Engine 接入。

| 图片 fit 的输入 | 处理 |
| --- | --- |
| 省略 | Rust 保留省略；TS 解析为 `"contain"` |
| `"contain"` / `"cover"` / `"stretch"` / `"height"` / `"width"` | TS 预期取值，解析时保留指定值 |
| null、空字符串、其他字符串或其他类型 | Rust 作为扩展字段保留；TS 运行时校验报错，阻止渲染 |

现有 [module-style.json](../desktop/examples/module-style.json) 的图片子配方省略 fit。应用该 Style 时，目标已有的 fit 会被清除；后续解析应用后的图片模块时得到默认 `"contain"`。Style 自身不预填默认值。

```ts
import { resolveImageRenderInput } from "./render-input";

// 仅演示 fit 的小型解析函数；整份文档应使用 validateRenderDocument。
const defaults = resolveImageRenderInput({ id: "picture", type: "image" });
// defaults.fit === "contain"

const explicit = resolveImageRenderInput({ id: "picture", type: "image", fit: "cover" });
// explicit.fit === "cover"
```

为后续字段添加默认值时，沿用以下步骤：

1. 在协议中明确字段类型、范围、默认值，以及省略和 null 的语义。Rust 不添加业务校验，渲染参数由 TS 检查。
2. 在 TS 文档类型中声明可选字段，在渲染输入类型中声明解析后的必填字段。
3. 在 `render-input/` 的集中默认常量中定义默认值，并接入统一校验入口。仅为省略的字段补值，预览与导出共用已解析输入，避免各自补默认值。

图片 fit 默认值位于 [image.ts](../desktop/src/render-input/image.ts)，其余通用参数见 [defaults.ts](../desktop/src/render-input/defaults.ts)。默认值改变会影响所有省略该字段的文档；需要固定行为时，在 JSON 中显式填写字段。数值或布尔字段保留合法的 0 和 false，不用 `value || defaultValue` 判断省略。小型 `resolveImageRenderInput` 只检查 fit；整份文档的入口为 `validateRenderDocument`。目前尚未接入实际绘制、预览或导出。

## 网格与放置记录

以下是布局约定；Rust 当前不检查正尺寸、父子模块类型、重复占位或越界，只保留 u32 二元组和放置记录的结构转换要求。

```json
{
  "id": "group-1",
  "type": "group",
  "layout": [2, 2],
  "gap": 16,
  "children": [
    {"position": [0, 0], "module": {"id": "image-1", "type": "image", "width": 320, "height": 320, "assetPath": "hero.png"}},
    {"position": [0, 1], "module": {"id": "text-1", "type": "text", "width": 320, "height": 80, "text": "英雄说明"}}
  ]
}
```

- group 必须有 layout，格式为 `[行数, 列数]`，两者均为大于零的 u32 整数。
- group 的 children 为放置记录数组，可为空或省略；序列化时空 children 可被省略。
- 每条记录必须有 position 和 module。position 为 `[行, 列]`，从零开始，两者均为非负 u32 整数；module 为实际模块对象，可再次是 group。
- 位置只属于当前父容器，模块内容对象不保存自己的 position。移动时更新放置记录，模块 ID、文字和素材保持不变。
- 每条记录仅占一个单元格。同一 group 中不允许重复占位，也不允许越界。允许空位，不创建占位模块。
- 不同 group 的坐标系独立，可以各自使用 `[0, 0]`；嵌套 group 的单元格数量与父级无关。
- children 的数组顺序不决定网格位置；位置由 position 唯一表达。调整数组顺序不会重新分配坐标。
- text/image/rect 不允许 layout 或非空 children。不支持对象形式的 column/row/grid/fixed 布局、跨行跨列 span，以及旧 elements。
- 新 TS 规则要求叶子 width/height 为正安全整数，不允许省略或 auto；group 的自然尺寸从子内容、padding、gap 和边框计算，不使用手动容器宽高。composition.width/height 控制最终 PNG 尺寸，允许正安全整数、auto 或省略。
- 放置记录允许其他扩展元数据，读写时保留；其内容不会被误当作模块结构递归处理。

Rust 使用 `Node { layout: Option<(u32, u32)>, children: Vec<PlacedModule>, ... }` 和 `PlacedModule { position: (u32, u32), module: Node, ... }` 表达；叶子模块不设置 layout。暂不引入独立 Tree 类、父指针、坐标映射文件或稠密二维数组。

## 图片处理声明

图片模块可声明 processors 数组，由 TS 处理链在素材加载并解码后按数组顺序调用。每一步接收前一步的输出，全部执行完再由后续布局层应用模块的 width/height/fit 等参数；裁剪、模糊等具体执行顺序由脚本或数组顺序明确表达。

```json
{
  "id": "picture",
  "type": "image",
  "assetPath": "logo.png",
  "width": 320,
  "height": 320,
  "processors": [
    ["square-focus.process", 12, 0.5]
  ]
}
```

- 每步统一为数组 `[函数标识, ...参数]`。Rust 的现有结构要求首项为字符串；非空要求由 TS 执行器检查，Rust 不再检查。按完整标识查找 TS 注册函数；例如 `square-focus.process`，不是文件路径、可执行代码或 Python 请求。
- 后续参数按顺序保留，可为任意 JSON 值。`["module.fn"]` 表示零个额外参数；`["module.fn",null]` 则明确传入一个 null。Rust 不将参数内部的 id/type/align 等名字当作节点字段校验。
- processors 可省略或为空数组，表示无处理。预期用于 image 模块，Rust 不再检查所属模块类型。现有 Serde 结构仍要求调用数组列表，不接受 null、单个调用数组、单个对象或字符串缩写。
- Rust/TS 共用 ImageProcessor 数据契约。Rust 使用 `ImageProcessor { function_id: String, args: Vec<Value> }`，通过自定义 Serde 输出和读取调用数组；TS 为只读元组。Node/StyleNode 使用 Vec<ImageProcessor>，空列表序列化时省略。
- Style 可指定完整 processors，应用时整体替换，省略时清除旧链；素材引用和文本仍保留。图片 JSON 保存展开后的实际调用声明，不引用 Style 文件。
- 旧 processor 单字段继续作为不解释的扩展数据保留；新架构不赋予其调用语义。当前也不执行旧 Python/Pillow 脚本。
- 本分支早期 `{script,function,params}` 格式已替换，读到旧对象声明时拒绝，不隐式转换。patch_document_node 更新 processors 时写入强类型字段，null 或空数组清除处理链。

Rust 负责序列化与状态管理，不执行 TS、不查询脚本注册表，也不校验声明的业务含义。TS 的 `src/image-processors/` 已实现显式函数注册表、入口查找和处理链顺序执行，包含未知标识、执行失败及无效输出报告。执行器将当前图片作为隐含的第一个参数，调用 `handler(image, ...args)`；入口返回图像对象或 Promise。执行器等待每一步完成，保护输入图片和参数；参数数量、类型和范围由注册入口检查。完整 Engine 的资源加载、布局及整图合成尚未实现；后续预览和导出复用此调用流程。Web Canvas 需要 WebView/浏览器，不依赖 Node.js 执行图片处理。接口和内置标识见 [处理函数映射与执行](tauri-image-processors.md)。

实际示例见 [上图下文 Style](../tmp/style-image-caption/README.md)：居中裁剪最大正方形 → 保留中央内切圆清晰、四角模糊；下方文字居中加粗。

## 编辑与 I/O

- set_group_layout 写入指定节点的 layout；不检查节点类型、零行列或已有模块越界，不自动删除或移动内容。
- set_module_position 写入指定直接子模块的坐标；不检查父节点类型、重复占位或越界。仍要求能找到目标节点及直接子模块。
- 两个接口均携带 expectedVersion，在文档副本上操作后统一提交。实际发生修改时增加文档 revision 和会话 version，并置 dirty；无变化时不增加版本。
- 跨父级移动、一次交换多个位置等结构批量编辑，目前通过 replace_document 一次提交完整文档；尚未增加专用命令。
- patch_document_node 修改扩展属性，拒绝将强类型结构字段 id/type/children/layout 写入扩展 map；其他扩展字段不再进行业务校验。结构编辑使用专用接口或 replace_document。
- 文件打开、模板创建、文档替换、节点编辑、编码保存、另存为及外部文件检测不再执行文档业务校验。解析/序列化失败返回错误，保留当前会话和源文件；版本、身份、未保存内容、文件名及外部修改冲突保护仍保留。

layout/position 只表达逻辑布局。Rust 不计算文字换行、行列像素尺寸或最终坐标。TS 已实现渲染参数校验，实际测量、布局与合成仍由后续 Engine 完成，预览与导出共用相同逻辑。

## 格式变更

旧 Python 实现、验收资源和旧 JSON 保持原样。Rust 新建文档使用 v0.2.0；读取时不再检查版本字符串，但仍需能够反序列化为现有文档结构。接受某个版本字符串不代表支持该版本语义，当前不做隐式格式转换。
