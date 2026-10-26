# Style 与模块资源

Style 是一次性参数应用配方，保存在独立资源文件中。应用结果保存为图片模块的实际属性；图片文档不内嵌 Style 配方，不建立动态来源引用。Rust 已实现一次性应用及 TS 调用接口；2026-10-26 已移除参数、布局与匹配校验，资源库 I/O 和渲染尚未实现。

## 资源类别与模块类型

资源根部用一个枚举区分用途：

```json
{
  "resourceKind": "style",
  "module": {
    "type": "text",
    "style": {"fontSize": 32, "color": "#FFFFFF"}
  }
}
```

```json
{
  "resourceKind": "image",
  "module": {
    "id": "description",
    "type": "text",
    "text": "实际内容",
    "style": {"fontSize": 32, "color": "#FFFFFF"}
  }
}
```

resourceKind 是资源用途，image 表示带实际内容的模块图片，可以包含 text/image/rect/group 任一种节点；module.type 则是模块自身的类型。子模块不重复声明 resourceKind，整份资源用途保持一致。

此 ModuleResource 封装表示单个模块资源，与完整 ImageDocument 不同。现有图片 JSON 的 documentId/revision/composition/modules、会话快照及 v0.2.0 格式保持原样；不会给已有图片 JSON 自动加字段。完整图片的渲染入口仍消费 ImageDocument。

## 复用方式

| 结构 | Rust | TypeScript |
| --- | --- | --- |
| 实际图片模块 | Node | ModuleNode |
| Style 参数节点 | StyleNode | StyleNode |
| 通用位置包装 | PlacedModule<T = Node> | PlacedModule<T = ModuleNode> |
| 网格、坐标 | (u32, u32) | GridLayout / GridPosition |
| 根部资源枚举 | ModuleResource::Image / Style | ModuleResource 的 resourceKind 联合类型 |

共用 layout 与 position/module 结构。Style 的 children 使用 PlacedModule<StyleNode>，实际内容使用 PlacedModule<Node>。这样 Style 不必填写虚假的节点 ID、文字和素材来源。现有 Serde 结构转换要求保留，原有文档业务规则不再检查。

StyleNode 声明 type、可选 layout、可选 children、可选 style 参数对象及 processors 数组。processors 复用图片模块的 ImageProcessor 定义，表示交给 TS Engine 执行的调用声明。其他宽高、gap、fit 等参数仍以展开的扩展字段保留，不增加 properties 包装。只描述装饰的样式可以省略 layout/children。Style 不携带目标图文内容，也不使用目标节点 ID 作为匹配条件。

Style.type 在 Rust 中使用 ModuleType 枚举，在 TS 中复用 ModuleNode 的 type 范围。TS 保持只读接口；ResourceKind 类型直接取自资源联合类型，避免维护另一份标识字符串列表。

Rust 入口为 `creator_document_core::{ModuleResource, ModuleType, StyleNode, PlacedModule}`；TS 从 `desktop/src/types/index.ts` 导入。完整组合示例见 [module-style.json](../desktop/examples/module-style.json)。

## 一次性应用

纯 Rust 入口为 `apply_style(&Node, &StyleNode) -> Result<Node>`，实现位于 `desktop/src-tauri/document-core/src/style_application.rs`。check_style_applicability 及检查命令已删除。

1. 克隆目标模块，不检查模块类型、参数、布局、重复占位或范围。
2. 整体替换 style 对象、processors 和受管理的渲染参数。遗漏的参数删除，不填入渲染默认值；processors 省略或为空时清除旧链。
3. 按 position 选择子配方；没有配方的目标子模块保持原样，没有目标的配方不创建模块。同一位置重复的子配方以数组中最后一项为准。
4. children 省略或为空时只应用当前模块；layout、children、position 属于目标结构，保留原值。

文字、素材引用、ID、标题、sourceNotes、扩展元数据和放置记录元数据保持原样。图片处理链作为渲染参数由 Style 管理，不再当作内容保留。输入图片和 Style 均不修改；应用使用显式工作栈，按坐标建立索引。

当前 Style 顶层支持的渲染参数：

| 字段 | 用途（Rust 当前不检查取值） |
| --- | --- |
| width、height | 模块尺寸 |
| contentScale | 内容缩放 |
| padding、gap、rowGap、columnGap | 内边距及间距 |
| offsetX、offsetY、zIndex | 偏移及层级 |
| fit | 图片适配方式 |
| processors | 处理声明；Serde 仍按 [字符串, ...JSON 参数] 的调用数组列表解码 |

普通渲染字段使用同一清单进行清除和写入，后续扩展时在同处增加；processors 使用独立强类型字段，整体克隆替换。其他顶层扩展字段可随 Style 读写，但不属于应用操作管理的字段，因此不会复制到目标，也不会因出现这些字段而拒绝应用。

style 内部不再检查 align、fontSize、lineHeight、radius、opacity、bold、font、color、background 或 border；style 对象整体复制，不解析颜色、背景、边框或资源，也不表示所有参数已有渲染实现。

ValidationReport 及字段诊断已删除。文档会话操作的 I/O/版本错误返回 DocumentError（code/message）。传输层无法反序列化的现有结构仍由 Tauri 报参数错误，例如 Style.type 仍是现有 ModuleType 枚举。

图片处理声明、执行顺序和职责见 [图片 JSON 协议](tauri-json.md#图片处理声明)。可实际应用的上图下文 Style、图片文档及 TS 处理脚本见 [临时示例](../tmp/style-image-caption/README.md)。完整函数标识通过已实现的 [TS 注册表与执行器](tauri-image-processors.md) 查找和调用；Style 应用本身仅展开声明，不调用脚本。

## TS 与会话接口

```ts
import { applyStyle, applyDocumentStyle } from "./styles";

// image 是 ModuleNode，style 是 StyleNode；资源封装需取出 .module。
const styledImage = await applyStyle(image, style);
// styledImage 是独立结果，不自动写入会话或磁盘。

// 已打开文档直接提交给 Rust，一次完成应用及会话更新。
const next = await applyDocumentStyle(
  snapshot.sessionId, snapshot.version, moduleId, style,
);
```

TS 封装位于 `desktop/src/styles/`，运行时需要 Tauri，分别对应 apply_module_style、apply_document_style 两个命令；不再提供 checkStyleApplicability 或预先校验。

会话入口为 `DocumentStore::apply_style`，要求 expectedVersion，成功后通过原有 commit 增加 version/revision 并更新 dirty，发送 document-state-changed；重复应用未产生变化时不增加版本。失败不提交，过期版本拒绝。保存仍调用 save_document，不自动写文件。TS 会拒绝不在非负安全整数范围内的 expectedVersion。

## 当前边界与验证

- Style 不产生预览，不计算像素布局，不执行图片处理工具，不解析 Style 名称或动态引用。
- 资源库文件读取与相对资源路径重定位尚未实现；当前 API 接收已加载对象。调用者需先将字体和背景素材路径解析为明确路径，否则实际参数仍按目标文档目录解释。
- 不将 StyleNode 当成可渲染图片；实际文字、素材和节点身份必须由目标模块提供。
- 普通 open_document 仍按完整 ImageDocument 反序列化，不接受缺少文档字段的模块资源封装；不执行额外业务校验。

移除校验前曾通过 68 个核心测试及临时 Style/处理链检查；这些是历史记录，不代表当前仍拒绝非法参数或结构不匹配。2026-10-26 未修改测试代码；现行 I/O 验证范围见 [开发文档](tauri-dev.md#creator-document-core-自动化测试)。尚未在实际 WebView 中验收 IPC。
