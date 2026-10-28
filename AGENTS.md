## Reference

- 当前迁移目标与分支范围：@README.md
- 旧 Python 产品行为（待废弃，仅作迁移参考）：@docs/template.md
- 当前 Tauri 图片 JSON 协议：@docs/tauri-json.md
- 旧 Python 图片 JSON 协议（迁移参考）：@image_create_tool/resources/JSON_PROTOCOL.md
- 开发说明：@docs/dev.md
- Tauri JSON 实现：@docs/tauri-dev.md
- Style/模块资源数据定义与应用：@docs/tauri-style.md
- TS 图片处理函数注册与调用：@docs/tauri-image-processors.md
- 旧 Python 代码规范（待废弃，不适用于 Rust / TypeScript）：@docs/CODING_STANDARDS.md

## 当前开发方向

- 后续开发围绕 `desktop/` 的 Tauri 架构进行，见 @docs/dev.md。
- 本分支实现图片描述 JSON 的 Rust 处理及 `desktop/src/types/` 中的 TS 只读数据契约及 `desktop/src/image-tools/` 基础图片处理工具；TypeScript GUI 和 Web 图片合成器在后续任务迁移，预览与导出共用合成逻辑。
- 下方 Python 说明仅供迁移核对，不作为新架构实现要求。

## 旧 Python 版本 v0.1.0（待废弃）

- Python 包 `image_create_tool`；GUI、服务和 Pillow 渲染器在同一进程的不同线程运行。
- 使用工作区 `.venv/Scripts/python.exe -m image_create_tool` 启动 GUI，在界面中打开或新建图片 JSON、检查预览问题并导出 PNG。
- 每张图片独立 JSON，GUI 不查找项目或固定 pjt.json；默认 PNG 与该 JSON 同名、同目录。
- Agent 可在目录中组织多张图片 JSON；项目说明自行维护，应用不生成 AGENTS.md。
- Style/Template 是全局 JSON 参数资源。应用 Style 一次性整体覆盖，遗漏属性恢复默认，实际图文内容和稳定 ID 保留；参数展开写入图片，之后不随全局文件变化。
- Template 复制创建后独立。模块无父子样式继承；布局容器可不设视觉装饰。
- 稳定 ID 必须保留。兼容读取旧 itemRow 时保留 `:text`、`:image` 子 ID。
- 素材查询使用 GUI 的“替换/选择素材”；不手动猜绝对素材路径。
- 未明确请求时不新增攻略结论、不改变用户推荐、不删减条件，保留完整 `sourceNotes`。
- 修改后先检查 GUI 预览与问题提示、再导出。文字超限按模块边界裁剪，仅警告；缺素材、非法 crop、字体或处理脚本错误、布局越界仍阻止导出。
- 验收使用 tool_test/ 中已复制的素材；旧图片仅作参考，不运行旧渲染脚本。
- 机器全局配置位置可用 IMAGE_CREATE_TOOL_HOME 覆盖；验收时使用工作区内配置目录，避免改动用户全局资源。

## Rules

- TypeScript（含 Vue 中的 TS）采用 Prettier 统一格式：两空格缩进、双引号、分号；配置见 `desktop/.prettierrc.json`。`if` / `else`、`for`、`while`、`do` 的语句体必须使用大括号并换行，即使只有一条语句。禁止将 `if` 条件与执行语句写在同一行。
- 修改 `desktop/` 的 TypeScript / Vue 后，运行 `npm run fix` 自动修复格式，并用 `npm run check` 检查 ESLint、Prettier、类型及构建。命令在 `desktop/` 下执行；不为纯格式调整新增测试。
- 未经用户明确要求，不新增或修改测试代码。
