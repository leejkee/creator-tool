# Style 与模块资源

Style 是一次性参数应用配方，保存在独立资源文件中。应用结果保存为图片模块的实际属性；图片文档不内嵌 Style 配方，不建立动态来源引用。现已实现 Rust 校验、匹配、应用及 TS 调用接口；资源库 I/O 和渲染尚未实现。

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

共用 layout 与 position/module 结构。Style 的 children 使用 PlacedModule<StyleNode>，实际内容使用 PlacedModule<Node>。这样 Style 不必填写虚假的节点 ID、文字和素材来源，实际文档也不会放宽原有必填规则。

StyleNode 声明 type、可选 layout、可选 children、可选 style 参数对象及 processors 数组。processors 复用图片模块的 ImageProcessor 定义，表示交给 TS Engine 执行的调用声明。其他宽高、gap、fit 等参数仍以展开的扩展字段保留，不增加 properties 包装。只描述装饰的样式可以省略 layout/children。Style 不携带目标图文内容，也不使用目标节点 ID 作为匹配条件。

Style.type 在 Rust 中使用 ModuleType 枚举，在 TS 中复用 ModuleNode 的 type 范围。TS 保持只读接口；ResourceKind 类型直接取自资源联合类型，避免维护另一份标识字符串列表。

Rust 入口为 `creator_document_core::{ModuleResource, ModuleType, StyleNode, PlacedModule}`；TS 从 `desktop/src/types/index.ts` 导入。完整组合示例见 [module-style.json](../desktop/examples/module-style.json)。

## 校验与应用

纯 Rust 入口为 `check_style_applicability(&Node, &StyleNode) -> ValidationReport` 和 `apply_style(&Node, &StyleNode) -> Result<Node>`，实现位于 `desktop/src-tauri/document-core/src/style_application.rs`。

1. 先用现有节点规则检查图片模块，再检查 Style 参数、布局和占位。
2. 节点类型必须一致。Style 提供 layout 时必须与目标相等；包含子配方的 Style 必须提供正整数 layout。
3. 子配方非空时，双方占用位置集合必须完全一致，允许同样的空格。按 position 匹配，逐层检查对应模块类型，数组顺序和 ID 不参与匹配。
4. children 省略或为空表示仅应用当前模块，后代保持原样。叶子 Style 不允许 layout 或非空 children。
5. 全部检查通过后才构造新模块，整体替换 style 对象、processors 和受管理的渲染参数。遗漏的参数删除，不填入渲染默认值；processors 省略或为空时清除旧链。layout、children、position 属于结构，保留原值。

文字、素材引用、ID、标题、sourceNotes、扩展元数据和放置记录元数据保持原样。图片处理链现作为渲染参数由 Style 管理，不再当作内容保留。输入图片和 Style 均不修改；失败返回全部诊断，不返回半成品。匹配和应用使用显式工作栈，按坐标建立索引。

当前 Style 顶层支持的渲染参数：

| 字段 | 校验 |
| --- | --- |
| width、height | 有限正数或 `"auto"` |
| contentScale | 有限正数 |
| padding、gap、rowGap、columnGap | 有限非负数 |
| offsetX、offsetY、zIndex | 有限数值 |
| fit | contain / cover / stretch / height / width |
| processors | 有序调用数组列表，非空时只允许 image；每项为 [非空函数标识, ...JSON 参数] |

普通渲染字段使用同一清单进行检查、清除和写入，后续扩展时在同处增加；processors 使用独立强类型字段，整体克隆替换。name/description/version 作为资源元数据允许存在，但不复制到目标。其余顶层字段拒绝应用，包括 id、text、assetId/assetPath、旧 processor 单字段和 elements/span 等，避免 Style 覆盖内容或引入旧结构。旧 x/y、titleStyle、textOverrides 尚未迁移，当前也不接受。

style 内部检查 align 枚举，fontSize/lineHeight 正数、radius 非负数、opacity 为 [0,1]、bold 为布尔值、font/color 为非空字符串；background 接受非空字符串或对象，border 接受对象。其余视觉扩展字段保留。颜色解析、背景/边框内部字段、字体和素材可用性仍留给后续协议与渲染层，不表示所有扩展参数已有渲染实现。

失败报告沿用 ValidationReport/DocumentError，包含 code/rule/path/message。路径以 `/image` 或 `/style` 开头，例如 `/style/children/1/module/type`。结构不匹配返回 STYLE_MISMATCH；非法参数返回 INVALID_STYLE，处理声明不合法返回 INVALID_PROCESSORS，不支持的顶层参数返回 UNSUPPORTED_STYLE。传输层无法反序列化的字段形状或枚举由 Tauri 报参数错误。

图片处理声明、执行顺序和职责见 [图片 JSON 协议](tauri-json.md#图片处理声明)。可实际应用的上图下文 Style、图片文档及 TS 处理脚本见 [临时示例](../tmp/style-image-caption/README.md)。完整函数标识通过已实现的 [TS 注册表与执行器](tauri-image-processors.md) 查找和调用；Style 应用本身仅展开声明，不调用脚本。

## TS 与会话接口

```ts
import { applyStyle, checkStyleApplicability, applyDocumentStyle } from "./styles";

// image 是 ModuleNode，style 是 StyleNode；资源封装需取出 .module。
const report = await checkStyleApplicability(image, style);
if (report.valid) {
  const styledImage = await applyStyle(image, style);
  // styledImage 是独立结果，不自动写入会话或磁盘。
}

// 已打开文档直接提交给 Rust，一次完成校验、应用及会话更新。
const next = await applyDocumentStyle(
  snapshot.sessionId, snapshot.version, moduleId, style,
);
```

`applyStyle` 自身总会校验，调用者不必先单独检查。TS 封装位于 `desktop/src/styles/`，通过 Tauri 调用 Rust，共用同一套规则，运行时需要 Tauri。分别对应 check_module_style、apply_module_style、apply_document_style 三个命令。

会话入口为 `DocumentStore::apply_style`，要求 expectedVersion，成功后通过原有 commit 增加 version/revision 并更新 dirty，发送 document-state-changed；重复应用未产生变化时不增加版本。失败不提交，过期版本拒绝。保存仍调用 save_document，不自动写文件。TS 会拒绝不在非负安全整数范围内的 expectedVersion。

## 当前边界与验证

- Style 不产生预览，不计算像素布局，不执行图片处理工具，不解析 Style 名称或动态引用。
- 资源库文件读取与相对资源路径重定位尚未实现；当前 API 接收已加载对象。调用者需先将字体和背景素材路径解析为明确路径，否则实际参数仍按目标文档目录解释。
- 不将 StyleNode 当成可渲染图片；实际文字、素材和节点身份必须由目标模块提供。
- 普通 open_document 不接受模块资源封装，完整图片文件流程继续使用原有文档校验规则。

初次应用实现通过现有 68 个核心测试、Rust/Tauri Clippy、TS 构建，以及仓库外临时程序的 102 项检查，覆盖组合示例、乱序匹配、参数重置、内容保留、不合法输入、失败原子性、会话版本、重复应用和显式保存。后续 processors 扩展另用临时程序检查真实 Style 应用、处理声明顺序、重置、非法参数及原子提交，并在浏览器 Canvas 中执行 TS 组合脚本。本次未新增或修改仓库测试代码；尚未在实际 WebView 中验收 IPC。
