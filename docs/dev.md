# Tauri 迁移开发说明

## 目标与当前分支

后续开发围绕 `desktop/` 的 Tauri 架构展开，逐步迁移 `image_create_tool/` 的 Python 实现。任务范围以 [README](../README.md#tauri-迁移任务与本分支范围) 为准。

| 部分 | 目标职责 | 本分支范围 |
| --- | --- | --- |
| Rust 后端 | 处理描述图片的 JSON | 本分支仅完成此部分 |
| TypeScript 前端 | 替代 PySide6 GUI | 后续迁移 |
| TypeScript 图片合成器 | 使用 Web 绘图工具，预览与导出共用合成逻辑 | 后续迁移 |

这是迁移目标，不表示相关功能已实现。Rust JSON 实现设计与接口见 [Tauri 开发文档](tauri-dev.md)；不直接沿用 Python 线程模型、Qt 桥接、Pillow 绘制或 Windows 文件句柄机制作为新架构要求。

当前图片描述采用 [Tauri JSON 协议 v0.2.0](tauri-json.md)，示例位于 `desktop/examples/grid.image.json`。

## 迁移参考

- [旧图片 JSON 协议](../image_create_tool/resources/JSON_PROTOCOL.md)与[示例](../image_create_tool/resources/example.image.json)：用于核对既有数据，不代表 Rust 部分已经实现兼容。
- [旧实现梳理](../design.md)：用于定位 Python 逻辑及已知行为。
- [旧模块与模板设计（待废弃）](template.md)：保留产品规则供迁移核对，不作为新架构实施计划。
- [旧 Python 代码规范（待废弃）](CODING_STANDARDS.md)：仅适用于旧 Python 工程，不作为 Rust / TypeScript 规范。

旧 `docs/refactor.md` 是已被后续设计取代的早期草案，已删除；其中的固定项目文件、动态 Theme 和模板版本依赖等设想不作为当前需求。

## 开发约束

- 新增迁移实现放在 `desktop/`，按 Rust JSON 处理、TypeScript 界面和图片合成的职责推进。
- 核对旧数据与行为时保留用户内容、`sourceNotes` 和稳定 ID；遇到兼容性取舍应明确记录，不把旧文档中的设想视为已确认需求。
- 本分支不扩展到 GUI 和图片合成器迁移，也不因旧文档中的待办增加实施范围。
- 未经用户明确要求，不新增或修改测试代码。文档改动检查引用和差异；实现改动按实际范围验证，不将未运行的检查描述为通过。
