# Tauri JSON 文档开发

TS 已实现统一渲染参数校验与默认值入口 `validateRenderDocument`，确认的尺寸、间距、自适应输出与警告规则见 [TS 渲染参数校验与布局规则](tauri-render-validation.md)。实际布局计算、资源加载与 PNG 出图仍待渲染 Engine 实现。

应用层已提供 Rust 本地字体枚举、TS 调用入口及系统默认字体解析，见 [本地字体与系统默认字体](tauri-fonts.md)。

## 职责与范围

Rust 是已打开图片文档的唯一权威状态管理者，负责文件 I/O、JSON 序列化与反序列化、模块树、编辑版本、保存基线、未保存状态及外部文件修改检测。TypeScript 维护选中节点、树展开、缩放、输入框草稿和拖动过程等界面状态，并持有用于展示和合成的文档副本。

图片模块树就是内存文档，JSON 是存储格式，不建立另一份独立可编辑的 JSON 状态。前端拖动结束或确认输入后提交正式修改；后端操作成功后返回完整的新状态。前端不得在请求失败时将本地草稿当成已提交文档。

本阶段实现新建、从已保存 JSON 模板创建、文档会话、加载、模块修改、Style 对象的一次性应用、整份文档提交、保存与另存为、外部变化检测与显式重载。2026-10-26 已移除文档及 Style 的业务校验，保留基本 I/O 和会话保护。不迁移 GUI、合成器、全局 Style/Template 资源库解析、旧格式转换、撤销重做或三方合并。

## 数据与会话

- 采用强类型文档和递归节点；暂未迁移的布局、样式等属性使用保留字段存储，避免读写时丢失数据。它们的完整语义校验留到对应能力迁移时完成。
- Serde 仍要求文档版本/documentId 为字符串、revision 为 u64、composition 为对象、modules 为节点数组，节点 id/type 为字符串。layout/position 仍按 u32 二元组解码。不再检查版本取值、字符串非空、节点类型枚举、ID 唯一性、父子关系或网格范围。
- 每个会话有独立 sessionId；同一规范化文件路径在本进程复用会话。会话拥有 document、path、workingDirectory、version、dirty、externalChange。
- version 是会话内单调递增的并发控制版本，与磁盘文档 revision 分开。前端所有修改、保存、重载和关闭都提交 expectedVersion，过期请求拒绝。
- 普通编辑增加文档 revision；保存不增加 revision。外部重载保留磁盘 revision，但增加会话 version。
- dirty 基于文档与最后一次加载或保存的基线比较，检测外部修改则比较原始文件字节；格式变化也算外部变化。

## 同步与文件保护

编辑流程：前端提交操作和 expectedVersion → Rust 在副本上修改 → 更新文档、版本和 dirty → 返回快照。初期返回完整文档，暂不引入增量同步协议。

保存是显式操作，不自动保存。保存前重新读取并比较磁盘基线；磁盘变化、丢失或不可读取时拒绝写入。使用同目录临时文件与原子替换避免半写文件；它不提供跨进程比较并交换保证，检查与替换之间仍有竞争窗口，暂不宣称跨进程互斥。

后端每 500ms 检查已打开文件的实际内容，不只比较修改时间。检测结果为 unchanged / modified / missing / unreadable，modified 携带解析后的候选或解析错误。外部修改不会覆盖本地文档；自身保存更新基线，不产生外部候选。文件恢复基线内容后清除外部状态。

变化通过 `document-state-changed` 事件通知前端，事件携带 sessionId 和 version。监听后再调用 get/list 补齐状态，按版本丢弃过期事件。也提供显式检查命令。文件删除、解析失败或文档身份变化时保留当前文档。

重载会丢弃内存内容；dirty 时必须显式传 discardChanges=true。关闭会话也遵循此规则。暂不提供强制覆盖外部修改或自动合并；用户可以重载有效候选，或先保留本地内容再另行处理。

## 实现入口与验证

纯 Rust 文档核心位于 `desktop/src-tauri/document-core/`，Tauri 命令与后台轮询适配位于 `desktop/src-tauri/src/`。核心不依赖 GUI/WebView，可独立构建。

核心源码按职责拆分，类型与相关实现放在同一模块中：

| 文件 | 职责 |
| --- | --- |
| lib.rs | 声明模块，通过 pub use 统一导出公共 API |
| document.rs | ImageDocument、Node、PlacedModule、协议版本常量及 JSON 编解码 |
| error.rs | DocumentError、Result 类型别名及错误比较 |
| session.rs | Snapshot、ExternalChange、Session、DocumentStore，以及版本、保存基线与外部变化管理 |
| storage.rs | 新文件写入和已有文件的原子替换 |
| lifecycle.rs | 新建、另存为、命名规则和资源路径重定位 |
| grid.rs | 节点查找、网格尺寸与放置坐标修改 |
| style.rs / style_application.rs | Style 资源定义及一次性应用 |
| processors.rs | 图片处理调用数组的 Serde 编解码 |

调用方继续从 creator_document_core 根路径导入原有类型和函数；模块内协作所需的接口使用 pub(super)，Session 及其内部状态不对外导出。拆分保持现有数据格式和业务行为，不恢复已移除的校验规则，也不新增或修改测试代码。

初期实现按仓库约束未新增测试代码；现已获得用户明确授权，为 creator-document-core 添加正式集成测试。验证包括 Rust 格式检查、核心与 Tauri 编译检查，以及临时目录中的真实文件 I/O 测试；结果与限制记录在本文后部。

## Tauri 命令契约

前端通过 `@tauri-apps/api/core` 的 invoke 调用；参数使用 camelCase。成功返回快照，包含 `sessionId/path/workingDirectory/document/version/dirty/externalChange`；I/O 和会话错误拒绝请求并返回 `{code, message}`。字段诊断 issues 及校验报告类型已删除。参数反序列化失败由 Tauri 报错。

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `create_document` | moduleName、可选 baseDirectory/sourceSessionId/templatePath | 创建并打开的新文档快照 |
| `save_document_as` | sessionId、expectedVersion、targetDirectory、fileName | 另存并切换当前会话后的快照 |
| `open_document` | path（已有文件路径） | 会话快照；重复打开同一路径复用会话 |
| `get_document` | sessionId | 当前内存快照 |
| `list_documents` | 无 | 全部会话快照 |
| `replace_document` | sessionId、expectedVersion、document | 整份文档提交后的快照，适用于结构调整 |
| `set_group_layout` | sessionId、expectedVersion、groupId、layout（二元组） | 修改网格后的快照 |
| `set_module_position` | sessionId、expectedVersion、groupId、moduleId、position（二元组） | 修改放置位置后的快照 |
| `patch_document_node` | sessionId、expectedVersion、nodeId、patch | 修改指定节点后的快照 |
| `apply_module_style` | image（Node）、style（StyleNode） | 返回独立的新 Node，不提交会话 |
| `apply_document_style` | sessionId、expectedVersion、moduleId、style | 一次性应用后的会话快照，不自动保存 |
| `save_document` | sessionId、expectedVersion | 保存后快照 |
| `check_document_file` | sessionId | 检查磁盘后的快照 |
| `reload_document` | sessionId、expectedVersion、discardChanges | 从当前磁盘内容重新加载后的快照 |
| `close_document` | sessionId、expectedVersion、discardChanges | 无；成功发送 `document-closed`，载荷为 sessionId |

`patch` 按属性整体替换，null 删除属性；嵌套 style 对象不会深度合并。为避免将强类型结构字段误写入扩展属性，patch 仍不支持 id/type/children/layout，结构编辑提交完整 document；elements/position/module/span 等扩展字段不再按旧协议规则拒绝。提交的 document 保留当前 documentId、协议版本和 revision，Rust 提交时增加 revision。整体提交可编辑画布、模块结构及其保留属性，但不会解析 Style 引用或查询素材，也不检查内容合法性。

processors 补丁接受完整调用数组列表，更新 Node 的强类型字段，不写入扩展属性；null 或空数组清除处理链。Serde 仍要求调用首项为字符串，不检查标识非空、注册情况或所属模块类型。解码失败不提交任何属性或版本修改。

外部状态 `externalChange=null` 表示磁盘仍为基线；否则为 `{kind:"modified", document, error}`、`{kind:"missing"}` 或 `{kind:"unreadable", error}`。有效候选提供 document，无效 JSON 或身份改变提供 error。界面应独立展示 dirty 和 externalChange。

事件与命令可能先后交错，前端以 sessionId/version 判断新旧；命令失败后可 get_document 刷新。get/list 不主动读磁盘，需要立即检查时调用 check_document_file。重载读取执行时的磁盘内容；它不是接受某一历史候选的合并操作。

## 当前限制

- 暂不提供自动保存、强制覆盖、历史或合并命令。新建/另存为不覆盖已有目录或文件；界面目录和文件选择器尚未接入。
- Rust 已删除业务校验；能够完成 I/O 不代表符合渲染协议或能够渲染。TS 已实现渲染参数校验与默认值，布局、样式、素材及字体的已确认规则见 [渲染参数校验与布局规则](tauri-render-validation.md)；实际布局、资源加载和绘制仍待 Engine 实现。不执行 Python 预处理器。
- 轮询读取文件内容，有 I/O 成本；单个 store 串行处理会话，适用于当前本地编辑场景。尚未实现大文件限制、跨进程会话互斥及崩溃后的会话恢复。
- 临时文件替换保证正常文件系统下目标文件不会出现半写内容，不保证断电后目录元数据持久化；崩溃可能遗留 `.creator-document-*.tmp`。不自动清理其他进程的临时文件。
- 当前不保留原始 JSON 排版和键顺序，保留的是文档内容及未迁移字段。

## 早期验证记录（移除校验前）

- Rust 核心 `cargo check`、`cargo clippy -- -D warnings` 通过。
- Tauri 后端 `cargo check --locked` 通过；Rust 格式检查通过。
- 使用临时目录中的示例副本进行操作验证：打开、中文节点编辑与保存、过期版本拒绝、dirty 关闭/重载保护、自身保存不触发外部事件、无效/有效外部 JSON 检测、冲突保存拒绝、文件删除与恢复、显式重载、重复节点 ID 拒绝及关闭会话。原始示例未修改；未新增仓库测试代码。
- 尚未通过实际 WebView 调用命令或验收前端事件接收；本分支没有迁移编辑界面和渲染器。

常规开发环境先安装 Rust 和平台所需的 Tauri 开发依赖，再运行：

```sh
cd desktop/src-tauri
cargo fmt --check
cargo check --locked
cargo clippy --locked -- -D warnings
cargo fmt --manifest-path document-core/Cargo.toml --check
cargo check --manifest-path document-core/Cargo.toml --locked
cargo test --manifest-path document-core/Cargo.toml --locked
cargo clippy --manifest-path document-core/Cargo.toml --locked -- -D warnings
```

本次云机器无系统安装权限，编译使用 `/workspace/.cargo`、`/workspace/.rustup` 内的 Rust 工具链，以及从已签名 Debian 仓库下载并在工作区解包的开发库。当前机器复用编译环境需先设置：

```sh
export PATH=/workspace/.cargo/bin:$PATH
export CARGO_HOME=/workspace/.cargo
export RUSTUP_HOME=/workspace/.rustup
export PKG_CONFIG_SYSROOT_DIR=/workspace/tauri-sysroot/root
export PKG_CONFIG_PATH=/workspace/tauri-sysroot/root/usr/lib/x86_64-linux-gnu/pkgconfig:/workspace/tauri-sysroot/root/usr/share/pkgconfig
```

这些是当前机器的编译路径，不是应用运行时依赖配置；尚未验证可启动桌面应用，也未更新或发布云环境快照。

## creator-document-core 自动化测试

当前保留 43 个集成测试，全部通过，无失败、忽略或过滤项。清理了已删除业务校验的测试及混合测试中的过期断言；不再引用 validation 模块、ImageDocument::validate、issues 报告或已移除的业务错误码。生产源码保持不变。

测试位于 `desktop/src-tauri/document-core/tests/`，仅依赖 Rust 核心和开发依赖 tempfile，无需 Tauri、WebView 或 Python。

| 文件 | 数量 | 当前覆盖范围 |
| --- | --- | --- |
| json_document.rs | 4 | 中文和未知字段往返、UTF-8 BOM、JSON 语法与 Serde 字段类型转换、模块序列化 |
| document_sessions.rs | 18 | 会话复用与隔离、内存编辑与显式保存、补丁语义、失败状态保留、并发版本、文档身份与 revision 归属、版本溢出、外部文件变化、重载与关闭保护 |
| document_lifecycle.rs | 12 | 新建目录与 JSON、并列新建、模板复制与路径重定位、命名和目录要求、另存为、防覆盖及冲突处理 |
| grid_placement.rs | 9 | 放置记录往返与元数据保留、Serde 二元组/u32 转换、节点查找、直接子节点关系、坐标更新、版本及磁盘状态、无操作提交与文档示例 |

Serde 的字段类型和可表示性要求继续保留，例如 u32 范围、二元组长度和必填的放置记录字段。测试不再要求 Rust 拒绝零网格尺寸、重复 ID、越界、重复占位、叶节点关系或样式业务参数。文件名规则、版本、文档身份和未保存状态属于 I/O 与会话保护，仍保留对应断言。

文件操作使用独立临时目录，通过显式 check/poll 驱动状态，不依赖固定 sleep，不改写真实素材或示例。全量运行无需跳过任何测试：

```sh
cargo test --manifest-path desktop/src-tauri/document-core/Cargo.toml --locked
cargo clippy --manifest-path desktop/src-tauri/document-core/Cargo.toml --all-targets --locked -- -D warnings
```

上述检查已在本次 Linux 环境通过。测试验证核心公开接口，不覆盖 Tauri 后台轮询调度、WebView 命令调用、平台原生文件锁或跨进程原子比较并交换。

## 新建模块与另存为

这里“模块”指用户创建的一份图片文档及其目录，区别于图片内部的模块节点。采用 IDE 创建工程的流程：

1. 必须提供 moduleName。没有工作目录或当前模块时，前端要求用户选择基础目录，通过 baseDirectory 传入；取消选择就不调用创建。后端不默认使用进程当前目录。
2. 已有打开模块时，前端传 sourceSessionId，复用该会话的 workingDirectory；显式选择 baseDirectory 时优先使用所选目录。后台不会自行选择列表中的某个会话。
3. 创建 `<基础目录>/<模块名>/<模块名>.json`，目录已存在即拒绝，不复用或覆盖。成功后建立 clean 会话。空白文档从 Rust 默认值创建，不依赖模板。
4. 例如已打开 `/work/模块A/模块A.json`，新模块 B 创建到 `/work/模块B/模块B.json`，与 A 并列。重新打开符合“同名目录/同名 JSON”约定的文件时，其基础目录为模块目录的父目录；旧式独立 JSON 的工作目录为该文件所在目录。
5. 可传 templatePath 从能反序列化为现有结构的图片 JSON 创建，不再检查版本字符串；保留内容、sourceNotes、节点 ID 及扩展字段，赋予新 documentId、revision=0、title=模块名。模板原文件不变。这里不是全局 Style/Template 资源解析。

另存为必须由前端要求用户选择 targetDirectory 并填写 fileName；后端要求目录已存在，不自动创建同名子目录，未提供 .json 后缀时补齐。目标文件已存在时拒绝，包括当前源文件；原路径保存应使用 save_document。成功后保留 sessionId、增加会话 version、生成新文档身份并从 revision=0 开始，将会话切换至新文件，清除 dirty 和外部候选。失败保留原会话和文件。未修改的源文件仍保留；如源文件有外部冲突，可将当前内存版本另存至新文件。

模板复制和另存为会将原目录相对的 assetsDir、字体、节点 assetPath、style.font 和背景 assetPath 转为明确绝对路径，以保持现有资源引用。对旧数据的 assetId/assetQuery 原样保留，并重定位 assetsDir 以保留旧引用关系；这一兼容处理不表示新 TS 渲染层支持旧素材 ID、查询或别名解析。新渲染方案只消费用户准备好的本地文件，统一使用 assetPath，见 [本地素材引用](tauri-render-validation.md#本地素材引用)。不会复制素材、展开样式、执行处理脚本或改写任意扩展字段、处理器参数及 sourceNotes。绝对路径不会使文档自动成为可移植资源包。

模块名和文件名禁止空白名称、路径分隔符、控制字符及常见 Windows 非法/保留名称。新建和另存为仅使用 create_new 写入不存在的目标；普通保存的原子替换逻辑不变。初次创建失败会尝试移除本次创建的空目录，不递归清理。

保留的 12 个生命周期测试覆盖未选择目录、并列新建、重新打开、目录冲突、模板复制与资源重定位、非法模板、显式目录优先、另存为命名/冲突/版本保护及外部冲突下保留本地副本。

## 当前解析与 I/O 边界

字段规则表、validate_document/validate_module/validate_json、ImageDocument::validate、Style 检查及相关报告类型已删除。validate_image_json、check_module_style 命令和 TS checkStyleApplicability 封装也已移除，没有保留始终返回成功的兼容校验接口。

ImageDocument::parse 去除 UTF-8 BOM 后直接反序列化；from_value 直接从 Value 转换；encode 直接序列化为缩进 JSON 并追加换行。没有业务校验，也不会补写渲染默认值。未知扩展属性仍通过 flatten 保留。

现有 Rust 结构的字段形状和基本类型要求仍由 Serde 承担；它不是任意 JSON 的原样存储器，也不保留原始排版。解析失败不建立会话或覆盖文件；编辑解码失败不提交副本。文件名约束、目标存在性、会话版本、文档身份、revision 归属、dirty 关闭/重载及外部修改冲突保护继续保留。

## 网格放置模型

当前协议已更新为 v0.2.0，完整结构与约束以 [Tauri 图片 JSON 协议](tauri-json.md) 为准。组合模块使用 layout 二元组和 children 放置记录，子模块坐标由父容器记录。旧 v0.1.0/elements 不自动迁移。

set_group_layout 和 set_module_position 分别写入 layout 及直接子模块的放置坐标。不再检查零尺寸、节点类型、越界或重复占位；仍要求能够找到节点及被操作的直接子模块。跨组移动和多位置交换暂使用 replace_document。实际像素布局由后续 TS 合成器处理。

网格测试已清理旧业务规则断言，保留数据往返、Serde 结构转换、节点定位和编辑状态等覆盖，不再检查重复占位、越界或模块类型限制。

## TypeScript 只读数据类型

统一从 `desktop/src/types/index.ts` 导入，定义仅包含 type/interface，没有类实例、可变单例、校验器或业务执行代码。

| 文件 | 定义 | Rust 对应 |
| --- | --- | --- |
| types/json.ts | JsonValue/JsonObject、ExtensionFields | serde_json::Value / flatten 扩展字段 |
| types/document.ts | ImageDocument、ModuleNode 联合类型、PlacedModule、网格二元组 | ImageDocument / Node / PlacedModule |
| types/session.ts | DocumentSnapshot、ExternalChange、事件载荷映射 | Snapshot / ExternalChange / Tauri 事件 |
| types/errors.ts | DocumentError（code/message） | I/O 与会话错误 |
| types/processors.ts | ImageProcessor 脚本调用声明 | ImageProcessor / Node.processors / StyleNode.processors |
| types/appearance.ts | 模块、文字、内容区、边框及带 type 的背景参数 | Rust 保留的 style 扩展对象；业务语义由 TS 检查 |

TS 用 type 标签表达文字、图片、矩形和组合模块的预期渲染契约；组合模块的 layout 必填，children 可省略；叶子模块的 width/height 必填，允许空 children 且不声明 layout。position 在放置记录中。Rust 当前不保证这些业务约定，TS 类型不是运行时校验器，应在渲染前调用 `src/render-input/` 的 `validateRenderDocument`。全部已声明成员及嵌套数组、JSON 对象为 readonly；readonly 不会在运行时冻结对象。

Rust 的 properties 通过 flatten 展开，TS 不添加额外 properties 包装。未知扩展字段为只读 unknown，需要收窄后使用。原始 composition 仍为 JsonObject；style 及素材字段的 TS 类型描述预期契约，来自 Rust 的实际数据仍需运行时校验。校验成功后使用独立的 DocumentRenderInput，默认值不回写，未知渲染参数不参与绘制，title/sourceNotes 等元数据仍留在原始文档。

ExternalChange 的 kind 与 Rust 序列化标签一致；modified 的 document/error 显式允许 null，Snapshot.externalChange 也显式允许 null。DocumentError 仅包含 code/message。document-closed 事件的载荷是 sessionId 字符串，不是快照。

Rust u32 网格二元组映射为 TS number，整数及 u32 范围由 Serde 转换要求保证；Rust 不检查正布局尺寸或网格越界，TS 在渲染前检查。叶子像素宽高仍是 Rust 扩展数据，由 TS 检查为正安全整数。revision/version 是 Rust u64，当前映射为 number；不能假定整个 u64 范围都能在 JS 中无损表达，渲染入口已检查 revision 为非负安全整数。

types 目录只定义数据结构；Style 的 invoke 封装位于 `src/styles/`，事件订阅、编辑器状态及图片合成尚未实现。运行 `cd desktop && npm run build` 已通过 TypeScript 检查与 Vite 构建；遵循仓库约束，未为类型声明新增测试代码。

## Style 资源及应用

已定义 Rust/TS 的 ModuleResource（resourceKind=image/style）和 StyleNode，两类资源复用泛型 PlacedModule 及网格坐标。Rust 提供 apply_style 和 DocumentStore::apply_style；TS 通过 src/styles/ 调用。应用时直接在副本中替换受管理参数，按位置选择子配方，不检查模块类型、布局、参数或占位匹配，保留内容、ID 和结构。会话提交沿用版本及 dirty 管理。完整接口及限制见 [Style 资源及应用](tauri-style.md)。

processors 已作为强类型调用声明接入图片和 Style，应用时整体替换；Rust 仅按调用数组反序列化，不检查业务含义或执行 TS。TS 的 src/image-processors/ 提供函数注册表、内置工具适配及异步顺序执行器，负责字符串到实际入口的映射、失败报告和输入保护，其运行时检查保持原样。完整资源加载、布局及整图合成留待后续实现。接口见 [处理函数映射与执行](tauri-image-processors.md)，实际示例接线位于 [tmp/style-image-caption](../tmp/style-image-caption/README.md)。
