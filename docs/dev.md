# Tauri 迁移开发说明

## 目标与当前分支

后续开发围绕 `desktop/` 的 Tauri 架构展开，逐步迁移 `image_create_tool/` 的 Python 实现。任务范围以 [README](../README.md#tauri-迁移任务与本分支范围) 为准。

| 部分 | 目标职责 | 本分支范围 |
| --- | --- | --- |
| Rust 后端 | 处理描述图片的 JSON | 已实现基础文档业务 |
| TypeScript 前端 | 替代 PySide6 GUI | 已定义只读数据契约，GUI 后续迁移 |
| TypeScript 图片合成器 | 使用 Web 绘图工具，预览与导出共用合成逻辑 | 基础裁剪/缩放/模糊工具已实现，完整布局与合成后续迁移 |

这是迁移目标，不表示相关功能已实现。Rust JSON 实现设计与接口见 [Tauri 开发文档](tauri-dev.md)；不直接沿用 Python 线程模型、Qt 桥接、Pillow 绘制或 Windows 文件句柄机制作为新架构要求。

当前图片描述采用 [Tauri JSON 协议 v0.2.0](tauri-json.md)，示例位于 `desktop/examples/grid.image.json`。独立 Style/模块资源的数据定义及一次性应用接口见 [Style 资源及应用](tauri-style.md)。

2026-10-26 起，Rust 已移除文档、网格、Style 和处理声明的业务校验，只保留现有 Serde 结构转换要求及文件 I/O、会话保护。TS 类型描述预期契约，不表示来自 Rust 的扩展字段已经过运行时校验；校验方案后续再设计。

图片处理链位于 `desktop/src/image-processors/`，统一用 `[函数标识, ...参数]` 表示调用。通过显式注册表映射到实际 TS 函数，提供内置工具适配、顺序调用和错误定位，见 [处理函数映射与执行](tauri-image-processors.md)。这部分可供后续完整合成器复用。

## 迁移参考

- [旧图片 JSON 协议](../image_create_tool/resources/JSON_PROTOCOL.md)与[示例](../image_create_tool/resources/example.image.json)：用于核对既有数据，不代表 Rust 部分已经实现兼容。
- [旧实现梳理](../design.md)：用于定位 Python 逻辑及已知行为。
- [旧模块与模板设计（待废弃）](template.md)：保留产品规则供迁移核对，不作为新架构实施计划。
- [旧 Python 代码规范（待废弃）](CODING_STANDARDS.md)：仅适用于旧 Python 工程，不作为 Rust / TypeScript 规范。

旧 `docs/refactor.md` 是已被后续设计取代的早期草案，已删除；其中的固定项目文件、动态 Theme 和模板版本依赖等设想不作为当前需求。

## 开发约束

- 新增迁移实现放在 `desktop/`，按 Rust JSON 处理、TypeScript 界面和图片合成的职责推进。
- 核对旧数据与行为时保留用户内容、`sourceNotes` 和稳定 ID；遇到兼容性取舍应明确记录，不把旧文档中的设想视为已确认需求。
- 当前实现 TS 数据契约和基础图片处理工具，尚不扩展到 GUI 和完整图片合成器迁移，也不因旧文档中的待办增加实施范围。
- 未经用户明确要求，不新增或修改测试代码。文档改动检查引用和差异；实现改动按实际范围验证，不将未运行的检查描述为通过。

## TypeScript 数据契约

入口为 `desktop/src/types/index.ts`，使用纯 type/interface 对应 Rust 的 IPC 数据，不持有会话、不执行解析或文件 I/O。详细对应与限制见 [Tauri 开发文档](tauri-dev.md#typescript-只读数据类型)。

## TypeScript 图片处理

`desktop/src/image-tools/` 提供矩形裁剪、指定圆心的圆形裁剪、等比例缩放与整图/圆外模糊。函数消费已解码图片，返回独立画布；不修改图片文档或 Rust 会话。API、参数及验证范围见 [TS 图片处理工具](ts-image-tools.md)。
