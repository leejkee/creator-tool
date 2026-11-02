# 开发与构建

应用介绍与操作方法见[README](../README.md)。开发前阅读[架构与需求基线](architecture.md)，按任务查阅对应需求，并遵循[AGENTS.md](../AGENTS.md)。

## 环境

当前桌面工程以 Windows 为使用范围。需要 Node.js 22.12+、npm、Rust stable 的 MSVC 工具链、Microsoft C++ Build Tools 和 WebView2；系统依赖的安装步骤见[Tauri 官方说明](https://v2.tauri.app/start/prerequisites/#windows)。仓库的前端 CI 使用 Node.js 24。

## 本地运行

在仓库根目录执行：

```powershell
cd desktop
npm ci
npm run tauri dev
```

`npm run dev` 仅启动前端开发服务，本地文件、系统字体与原生窗口能力需要通过 Tauri 应用使用。

## 检查

修改 TypeScript 或 Vue 后，在 `desktop/` 下执行：

```powershell
npm run fix
npm run check
```

`check` 包含 ESLint、Prettier、TypeScript 检查与前端构建。

修改 Rust 后，在仓库根目录执行：

```powershell
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check
cargo check --manifest-path desktop/src-tauri/Cargo.toml --locked
cargo clippy --manifest-path desktop/src-tauri/Cargo.toml --locked --lib -- -D warnings
```

修改文档时检查相对链接、规则归属与冲突。以上命令不运行测试；测试由用户另行安排，静态检查和构建结果不代表桌面交互或渲染验收。

## 生成安装包

在 `desktop/` 下执行：

```powershell
npm run tauri build
```

Windows 安装包输出至 `desktop/src-tauri/target/release/bundle/`。安装包构建与系统要求见[Tauri Windows 打包说明](https://v2.tauri.app/distribute/windows-installer/)。

## 示例与实现入口

- [创作示例](../desktop/examples/创作示例/创作示例.json)：可直接通过 `desktop/examples` 工作区打开的完整文档。
- [网格数据示例](../desktop/examples/grid.image.json)、[Style 数据示例](../desktop/examples/module-style.json)：数据结构参考；作为模板选择前须遵循文档命名规则。
- [GUI 功能定位表](Gui-func-table.md)：界面入口与实现逻辑索引。
- [架构与需求基线](architecture.md)：职责和需求文档入口。
