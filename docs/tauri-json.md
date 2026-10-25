# Tauri 图片 JSON 协议 v0.2.0

本协议描述当前 Rust 实现。与 Python v0.1.0 的 elements/对象布局不兼容；Rust 不自动转换、猜测位置或覆盖旧文件。开发接口见 [Tauri 开发文档](tauri-dev.md)，完整示例见 [grid.image.json](../desktop/examples/grid.image.json)。

## 文档与模块

一份文档包含 `image-create-tool-version: "v0.2.0"`、非空 documentId、非负整数 revision、composition 对象和 modules 数组。文档的工作目录、dirty 和会话版本是 Rust 会话状态，不写入 JSON。

modules 仍是顶层模块列表；本次不改变其画布组合规则，也不为顶层模块推导网格位置。需要整体网格时，在 modules 中放置一个 group，由它管理子模块布局。

模块共同字段为非空 id、type，type 为 text/image/rect/group。整个文档中的模块 ID 唯一；text 模块要求 text 字符串，允许空文本。样式、素材引用和其他扩展字段仍随模块保存。未知字段保留，但旧 elements、模块内的 position 及多格 span 属于明确禁用的结构字段。

## 网格与放置记录

```json
{
  "id": "group-1",
  "type": "group",
  "layout": [2, 2],
  "gap": 16,
  "children": [
    {"position": [0, 0], "module": {"id": "image-1", "type": "image", "assetPath": "hero.png"}},
    {"position": [0, 1], "module": {"id": "text-1", "type": "text", "text": "英雄说明"}}
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

- 每步统一为非空数组 `[函数标识, ...参数]`。首项必须是非空字符串，按完整标识查找 TS 注册函数；例如 `square-focus.process`，不是文件路径、可执行代码或 Python 请求。
- 后续参数按顺序保留，可为任意 JSON 值。`["module.fn"]` 表示零个额外参数；`["module.fn",null]` 则明确传入一个 null。Rust 不将参数内部的 id/type/align 等名字当作节点字段校验。
- processors 可省略或为空数组，表示无处理；非空数组仅允许 image 模块。不接受 null、单个调用数组、单个对象或字符串缩写，必须是调用数组列表。
- Rust/TS 共用 ImageProcessor 数据契约。Rust 使用 `ImageProcessor { function_id: String, args: Vec<Value> }`，通过自定义 Serde 输出和读取调用数组；TS 为只读元组。Node/StyleNode 使用 Vec<ImageProcessor>，空列表序列化时省略。
- Style 可指定完整 processors，应用时整体替换，省略时清除旧链；素材引用和文本仍保留。图片 JSON 保存展开后的实际调用声明，不引用 Style 文件。
- 旧 processor 单字段继续作为不解释的扩展数据保留；新架构不赋予其调用语义。当前也不执行旧 Python/Pillow 脚本。
- 本分支早期 `{script,function,params}` 格式已替换，读到旧对象声明时拒绝，不隐式转换。patch_document_node 更新 processors 时写入强类型字段，null 或空数组清除处理链。

Rust 负责声明校验、序列化与状态管理，不执行 TS、不查询脚本注册表。TS 的 `src/image-processors/` 已实现显式函数注册表、入口查找和处理链顺序执行，包含未知标识、执行失败及无效输出报告。执行器将当前图片作为隐含的第一个参数，调用 `handler(image, ...args)`；入口返回图像对象或 Promise。执行器等待每一步完成，保护输入图片和参数；参数数量、类型和范围由注册入口检查。完整 Engine 的资源加载、布局及整图合成尚未实现；后续预览和导出复用此调用流程。Web Canvas 需要 WebView/浏览器，不依赖 Node.js 执行图片处理。接口和内置标识见 [处理函数映射与执行](tauri-image-processors.md)。

实际示例见 [上图下文 Style](../tmp/style-image-caption/README.md)：居中裁剪最大正方形 → 保留中央内切圆清晰、四角模糊；下方文字居中加粗。

## 编辑与校验

- set_group_layout 修改指定 group 的行列数；零行列或导致已有模块越界时拒绝，绝不自动删除或移动内容。
- set_module_position 修改指定 group 的直接子模块坐标；目标已占用、越界、父级不是 group 或子模块不属于该父级时拒绝。
- 两个接口均携带 expectedVersion，在文档副本上操作，校验成功后统一提交。实际发生修改时增加文档 revision 和会话 version，并置 dirty；无变化时不增加版本。
- 跨父级移动、一次交换多个位置等结构批量编辑，目前通过 replace_document 一次提交完整合法文档；尚未增加专用命令。
- patch_document_node 仅修改普通属性；拒绝 id/type/children/layout/position/module/span/elements。不通过修改内容字段间接改变布局结构。
- 同一套校验应用于文件打开、模板创建、文档替换、节点编辑、编码保存、另存为及外部文件检测。错误路径指向具体位置，例如 `/modules/0/children/1/position` 或 `/modules/0/children/1/module/text`。

layout/position 只表达逻辑布局。Rust 不计算文字换行、行列像素尺寸或最终坐标，TS 根据画布、内容和视觉参数完成测量与合成，预览与导出使用相同逻辑。gap 等视觉参数保留但当前尚未做完整数值校验。

## 格式变更

旧 Python 实现、验收资源和旧 JSON 保持原样。Rust 新建文档使用 v0.2.0，从模板创建只接受相同版本；旧文件需要后续明确的数据迁移流程，当前不支持隐式转换。
