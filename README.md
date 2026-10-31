# 图片 JSON 编辑器

基于 Tauri 的本地图片创作工具：使用独立 JSON 描述模块内容、网格和样式，通过共享的 TypeScript 渲染逻辑预览并导出 PNG。核心迁移基本完成，后续开发以 `desktop/` 为基础；旧 Python 工程仅保留为历史参考，不继续维护迁移演示。

## 需求入口

先读[架构与需求基线](docs/architecture.md)，再按任务查阅对应明细：

| 文档 | 内容 |
| --- | --- |
| [文档与文件](docs/document.md) | JSON 协议、会话、编辑、新建、模板、保存和外部变化 |
| [渲染](docs/rendering.md) | 参数、默认值、网格、输出适配、图文外观、诊断和出图验收 |
| [资源与复用](docs/resources.md) | 本地图片、字体、处理链、基础图片操作、Style 和模块资源 |

需求只在上述文档定义；开发约束见 [AGENTS.md](AGENTS.md)。源码说明实际实现，不以历史演示或旧文档补充当前需求。

## 迁移状态与后续工作

当前范围内的核心迁移基本完成：Rust 文档处理与会话、一次性 Style 应用、TS 数据契约及渲染校验、图片处理链和 Canvas Engine 均已提供实现。第一版 GUI 已接入工作区、模块编辑、预览、保存及 PNG 导出；完整桌面交互仍需在 Windows Tauri 环境验收。

| 能力 | 状态 |
| --- | --- |
| Rust 文档读写、会话、编辑、模板复制、另存为和外部变化保护 | 已有实现 |
| 模块组合关系 | 已调整为由 `layout` 和子模块表达，Rust、TS、Style 与当前示例已同步；协议见文档需求 |
| TS 只读契约、渲染参数校验和默认值 | 已有实现 |
| Style 对象的一次性应用、图片处理工具和处理链、本地字体枚举、缺图占位资源 | 已有基础实现 |
| Canvas Engine：本地素材读取、字体回退、像素布局、图文合成、PNG 数据编码 | 已有实现；用户已进行一次 JSON 出图验证，尚不代表模块模型调整后或完整 GUI 流程验收 |
| GUI 工作区与文档管理 | 已接入系统原生文件与目录选择，支持工作区、图片、JSON 模板、多 JSON 候选及另存为；已有配置持久化、一级扫描、新建及模板、单文档切换和未保存保护 |
| GUI 模块编辑 | 已实现预览点选、当前模块属性表单、输入草稿与应用、增删及父子位置调整；拖放仍为 TODO |
| TS 编辑工作副本与保存 | 已实现；保存时提交完整已应用内容，Rust 使用候选会话完成可靠写入，失败保留前端编辑和原保存基线 |
| 素材复制及 autosave | 已接入保存流程，包含素材版本检查及重名后缀；自动保存可开关，默认关闭 |
| PNG 文件导出 | 已接入成功预览 Canvas 的编码、默认路径、覆盖确认、文件状态与素材覆盖保护及磁盘写入 |
| 外部变化与诊断 | 已接入清洁文档自动重载、本地编辑冲突提示、非法或丢失文件保护、过期预览标记及展开诊断 |
| 底部信息区域 | 悬停说明、表单、确认、参数和字体候选及诊断在底部布局内显示；内置文件浏览器已移除，文件和目录通过系统原生窗口选择 |
| 实际 Tauri WebView 完整流程 | 尚待 Windows 环境交互验收；静态构建通过不代表运行流程已经验收 |

Engine 公共入口为 [desktop/src/render-engine/index.ts](desktop/src/render-engine/index.ts)，提供独立文档渲染、已有结果的 PNG 编码、一次渲染并编码，以及 Tauri 本地资源读取适配。接口支持独立 JSON 与明确目录输入，不依赖打开的文档会话，不改写源数据或保存文件。

GUI 入口为 [desktop/src/App.vue](desktop/src/App.vue)。组件只使用独立的[界面契约](desktop/src/editor/contracts.ts)与编辑应用层；图片 JSON 映射、Engine 调用、Tauri 文件接口分别放在适配层，便于后续协议调整。图片处理链目前通过属性面板中的参数 JSON 编辑，尚无逐步骤可视化表单。Style 与模块资源库入口未纳入本轮界面。

本轮以 Windows 为使用范围。测试由用户后续安排，开发中不新增、修改或运行测试；格式、静态检查和构建不代表渲染结果或桌面交互已经验收。

## 开发与检查

本机需具备 Node.js、Rust 和对应平台的 Tauri 构建环境。在 `desktop/` 下执行：

```powershell
npm ci
npm run tauri dev
```

`npm run dev` 只启动前端开发服务，不提供原生文件和字体能力。TypeScript / Vue 修改后执行：

```powershell
npm run fix
npm run check
```

从仓库根目录检查 Rust/Tauri 编译及 Clippy（不运行测试）：

```powershell
cargo check --manifest-path desktop/src-tauri/Cargo.toml --locked
cargo clippy --manifest-path desktop/src-tauri/Cargo.toml --locked --lib -- -D warnings
```

Rust 修改还需执行相关工程的格式检查。测试由用户另行安排。

## 示例与保留资料

- `desktop/examples/grid.image.json`：当前结构的图片 JSON 示例；`module-style.json`：Style 资源示例。
- [tool_test/](tool_test/README.md)：仅保留原始图片素材副本及来源清单，供后续实图测试使用，不是应用运行时依赖。
- `acceptance/`：历史内容来源；原始笔记不因文档整理而修改。
- `image_create_tool/`：旧 Python 实现及其资源协议，不作为 Tauri 需求入口。

迁移临时工程、旧协议图片 JSON、历史验收脚本与报告、演示出图及局部配置已清理。后续输入和验收以当前需求及 Engine 接口为准，不再使用旧迁移演示作为开发入口。
