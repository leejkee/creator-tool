# Tauri JSON 文档开发

## 职责与范围

Rust 是已打开图片文档的唯一权威状态管理者，负责文件 I/O、JSON 序列化与反序列化、模块树、编辑版本、保存基线、未保存状态及外部文件修改检测。TypeScript 维护选中节点、树展开、缩放、输入框草稿和拖动过程等界面状态，并持有用于展示和合成的文档副本。

图片模块树就是内存文档，JSON 是存储格式，不建立另一份独立可编辑的 JSON 状态。前端拖动结束或确认输入后提交正式修改；后端校验成功后返回完整的新状态。前端不得在请求失败时将本地草稿当成已提交文档。

本阶段实现新建、从已保存 JSON 模板创建、文档会话、加载与校验、模块修改、整份文档提交、保存与另存为、外部变化检测与显式重载。不迁移 GUI、合成器、Style/Template 解析、旧格式转换、撤销重做或三方合并。

## 数据与会话

- 采用强类型文档和递归节点；暂未迁移的布局、样式等属性使用保留字段存储，避免读写时丢失数据。它们的完整语义校验留到对应能力迁移时完成。
- 仅接收 `v0.1.0`；要求非空文档 ID、非负整数版本、画布对象、模块数组、全局唯一的非空节点 ID。节点类型为 text/image/rect/group，叶节点不可含非空子节点。
- 每个会话有独立 sessionId；同一规范化文件路径在本进程复用会话。会话拥有 document、path、workingDirectory、version、dirty、externalChange。
- version 是会话内单调递增的并发控制版本，与磁盘文档 revision 分开。前端所有修改、保存、重载和关闭都提交 expectedVersion，过期请求拒绝。
- 普通编辑增加文档 revision；保存不增加 revision。外部重载保留磁盘 revision，但增加会话 version。
- dirty 基于文档与最后一次加载或保存的基线比较，检测外部修改则比较原始文件字节；格式变化也算外部变化。

## 同步与文件保护

编辑流程：前端提交操作和 expectedVersion → Rust 在副本上修改并校验 → 更新文档、版本和 dirty → 返回快照。初期返回完整文档，暂不引入增量同步协议。

保存是显式操作，不自动保存。保存前重新读取并比较磁盘基线；磁盘变化、丢失或不可读取时拒绝写入。使用同目录临时文件与原子替换避免半写文件；它不提供跨进程比较并交换保证，检查与替换之间仍有竞争窗口，暂不宣称跨进程互斥。

后端每 500ms 检查已打开文件的实际内容，不只比较修改时间。检测结果为 unchanged / modified / missing / unreadable，modified 携带解析后的候选或解析错误。外部修改不会覆盖本地文档；自身保存更新基线，不产生外部候选。文件恢复基线内容后清除外部状态。

变化通过 `document-state-changed` 事件通知前端，事件携带 sessionId 和 version。监听后再调用 get/list 补齐状态，按版本丢弃过期事件。也提供显式检查命令。文件删除、解析失败或文档身份变化时保留当前文档。

重载会丢弃内存内容；dirty 时必须显式传 discardChanges=true。关闭会话也遵循此规则。暂不提供强制覆盖外部修改或自动合并；用户可以重载有效候选，或先保留本地内容再另行处理。

## 实现入口与验证

纯 Rust 文档核心位于 `desktop/src-tauri/document-core/`，Tauri 命令与后台轮询适配位于 `desktop/src-tauri/src/`。核心不依赖 GUI/WebView，可独立构建。

初期实现按仓库约束未新增测试代码；现已获得用户明确授权，为 creator-document-core 添加正式集成测试。验证包括 Rust 格式检查、核心与 Tauri 编译检查，以及临时目录中的真实文件 I/O 测试；结果与限制记录在本文后部。

## Tauri 命令契约

前端通过 `@tauri-apps/api/core` 的 invoke 调用；参数使用 camelCase。成功返回快照，包含 `sessionId/path/workingDirectory/document/version/dirty/externalChange`；领域错误拒绝请求并返回 `{code, message}`。参数反序列化失败由 Tauri 报错。

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `create_document` | moduleName、可选 baseDirectory/sourceSessionId/templatePath | 创建并打开的新文档快照 |
| `save_document_as` | sessionId、expectedVersion、targetDirectory、fileName | 另存并切换当前会话后的快照 |
| `open_document` | path（已有文件路径） | 会话快照；重复打开同一路径复用会话 |
| `get_document` | sessionId | 当前内存快照 |
| `list_documents` | 无 | 全部会话快照 |
| `replace_document` | sessionId、expectedVersion、document | 整份文档提交后的快照，适用于结构调整 |
| `patch_document_node` | sessionId、expectedVersion、nodeId、patch | 修改指定节点后的快照 |
| `save_document` | sessionId、expectedVersion | 保存后快照 |
| `check_document_file` | sessionId | 检查磁盘后的快照 |
| `reload_document` | sessionId、expectedVersion、discardChanges | 从当前磁盘内容重新加载后的快照 |
| `close_document` | sessionId、expectedVersion、discardChanges | 无；成功发送 `document-closed`，载荷为 sessionId |

`patch` 按属性整体替换，null 删除属性；嵌套 style 对象不会深度合并。禁止通过 patch 修改 id/type/elements，结构编辑提交完整 document。提交的 document 保留当前 documentId、协议版本和 revision，Rust 校验成功后增加 revision。整体提交可编辑画布、模块结构及其保留属性，但不会解析 Style 引用或查询素材。

外部状态 `externalChange=null` 表示磁盘仍为基线；否则为 `{kind:"modified", document, error}`、`{kind:"missing"}` 或 `{kind:"unreadable", error}`。有效候选提供 document，无效 JSON 或身份改变提供 error。界面应独立展示 dirty 和 externalChange。

事件与命令可能先后交错，前端以 sessionId/version 判断新旧；命令失败后可 get_document 刷新。get/list 不主动读磁盘，需要立即检查时调用 check_document_file。重载读取执行时的磁盘内容；它不是接受某一历史候选的合并操作。

## 当前限制

- 暂不提供自动保存、强制覆盖、历史或合并命令。新建/另存为不覆盖已有目录或文件；界面目录和文件选择器尚未接入。
- 基础校验不等同于完整 JSON 协议或可渲染校验。保留的布局、样式、素材、字体与处理器参数尚未逐项校验，也不执行 Python 预处理器。
- 轮询读取文件内容，有 I/O 成本；单个 store 串行处理会话，适用于当前本地编辑场景。尚未实现大文件限制、跨进程会话互斥及崩溃后的会话恢复。
- 临时文件替换保证正常文件系统下目标文件不会出现半写内容，不保证断电后目录元数据持久化；崩溃可能遗留 `.creator-document-*.tmp`。不自动清理其他进程的临时文件。
- 当前不保留原始 JSON 排版和键顺序，保留的是文档内容及未迁移字段。

## 本阶段验证记录

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

用户授权后现有 37 个集成测试（JSON 7 个、会话及文件同步 18 个、新建及另存为 12 个），当前全部通过，无失败或跳过。测试位于 `desktop/src-tauri/document-core/tests/`，仅依赖 Rust 核心和开发依赖 tempfile，无需 Tauri、WebView 或 Python。

- `json_document.rs`：中文与未知字段往返、UTF-8 BOM、非法 JSON/字段类型、协议版本、文档身份、节点 ID、节点类型及叶子节点约束。
- `document_sessions.rs`：会话复用与隔离、显式保存、无操作提交、补丁语义、拒绝操作的状态完整性、并发版本、revision 溢出、外部候选、格式变化、丢失与不可读文件、基线恢复、重载及关闭保护。
- `document_lifecycle.rs`：新建目录及 JSON、并列创建、模板资源重定位、同名拒绝覆盖、另存为会话切换及冲突保护。
- 文件操作使用独立临时目录，通过显式 check/poll 驱动状态，不依赖固定 sleep；不会改写真实素材或示例。

从仓库根目录运行：

```sh
cargo test --manifest-path desktop/src-tauri/document-core/Cargo.toml --locked
cargo clippy --manifest-path desktop/src-tauri/document-core/Cargo.toml --all-targets --locked -- -D warnings
```

这些测试验证核心公开接口，不覆盖 Tauri 后台轮询调度、WebView 命令调用、平台原生文件锁或跨进程原子比较并交换。当前仅在 Linux 执行。

## 新建模块与另存为

这里“模块”指用户创建的一份图片文档及其目录，区别于图片内部的模块节点。采用 IDE 创建工程的流程：

1. 必须提供 moduleName。没有工作目录或当前模块时，前端要求用户选择基础目录，通过 baseDirectory 传入；取消选择就不调用创建。后端不默认使用进程当前目录。
2. 已有打开模块时，前端传 sourceSessionId，复用该会话的 workingDirectory；显式选择 baseDirectory 时优先使用所选目录。后台不会自行选择列表中的某个会话。
3. 创建 `<基础目录>/<模块名>/<模块名>.json`，目录已存在即拒绝，不复用或覆盖。成功后建立 clean 会话。空白文档从 Rust 默认值创建，不依赖模板。
4. 例如已打开 `/work/模块A/模块A.json`，新模块 B 创建到 `/work/模块B/模块B.json`，与 A 并列。重新打开符合“同名目录/同名 JSON”约定的文件时，其基础目录为模块目录的父目录；旧式独立 JSON 的工作目录为该文件所在目录。
5. 可传 templatePath 从已保存的 v0.1.0 图片 JSON 创建；保留内容、sourceNotes、节点 ID 及扩展字段，赋予新 documentId、revision=0、title=模块名。模板原文件不变。这里不是全局 Style/Template 资源解析。

另存为必须由前端要求用户选择 targetDirectory 并填写 fileName；后端要求目录已存在，不自动创建同名子目录，未提供 .json 后缀时补齐。目标文件已存在时拒绝，包括当前源文件；原路径保存应使用 save_document。成功后保留 sessionId、增加会话 version、生成新文档身份并从 revision=0 开始，将会话切换至新文件，清除 dirty 和外部候选。失败保留原会话和文件。未修改的源文件仍保留；如源文件有外部冲突，可将当前内存版本另存至新文件。

模板复制和另存为会将原目录相对的 assetsDir、字体、节点 assetPath、style.font 和背景 assetPath 转为明确绝对路径，以保持现有资源引用；assetId/assetQuery 保留并继续相对原 assetsDir 解释。不会复制素材、展开样式、执行处理脚本或改写任意扩展字段、处理器参数及 sourceNotes。绝对路径不会使文档自动成为可移植资源包。

模块名和文件名禁止空白名称、路径分隔符、控制字符及常见 Windows 非法/保留名称。新建和另存为仅使用 create_new 写入不存在的目标；普通保存的原子替换逻辑不变。初次创建失败会尝试移除本次创建的空目录，不递归清理。

本次新增 12 个生命周期测试，总计 37 个核心集成测试，覆盖未选择目录、并列新建、重新打开、目录冲突、模板复制与资源重定位、非法模板、显式目录优先、另存为命名/冲突/版本保护及外部冲突下保留本地副本。
