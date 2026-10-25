# 图片 JSON 编辑器 v0.1.0

## Tauri 迁移任务与本分支范围

接下来逐步将 `image_create_tool/` 中的 Python 工程迁移到 `desktop/` 中的 Tauri 应用，职责划分如下：

- **GUI**：将原 PySide6 界面迁移为 Tauri 前端的 TypeScript 界面。
- **图片合成器**：将原 Python/Pillow 图片合成器迁移为 TypeScript 实现，使用 Web 绘图工具，并让预览与最终导出共用同一套合成逻辑，保证生成结果与预览一致。
- **图片 JSON 处理**：将原 Python 中对图片描述 JSON 的处理逻辑迁移为 Tauri 后端的 Rust 实现。

**本分支 `refactor/tauri-init` 实现图片描述 JSON 的 Rust 处理，并补齐对应的 TS 只读数据类型及基础图片处理工具。** GUI 与图片合成器的 TypeScript 迁移留待后续任务逐步完成。本节描述迁移目标与任务范围，不表示这些功能已经实现；下文仍为现有 Python 应用的使用说明。

基础裁剪和缩放工具见 [TS 图片处理工具](docs/ts-image-tools.md)。迁移开发入口见 [开发说明](docs/dev.md)，Rust JSON 状态与同步接口见 [Tauri 开发文档](docs/tauri-dev.md)，当前网格结构见 [JSON 协议 v0.2.0](docs/tauri-json.md)及[示例](desktop/examples/grid.image.json)。旧 Python 设计文档已标记为待废弃，仅供迁移核对。

## 旧 Python 应用（待废弃，仅供迁移参考）

PySide6 GUI、文件服务和 Pillow 渲染器在同一进程中协作。每张图片保存为独立 JSON，GUI 直接打开文件；默认 PNG 与 JSON 同名、同目录。Agent 可在一个目录中组织多张图片，应用不要求项目清单或固定的 `pjt.json`。

## 运行

使用工作区 Python，安装时沿用现有依赖：

```powershell
.venv/Scripts/python.exe -m pip install -e .
.venv/Scripts/python.exe -m image_create_tool
```

安装后也可运行 `guide-editor`，Windows 下该入口使用 GUI 启动器。应用直接进入编辑器，在界面中打开或新建图片 JSON；不提供命令行子命令或参数。

可打开 `image_create_tool/resources/example.image.json` 查看示例，或打开 `tool_test/pjt.json` 查看真实素材验收图片。文件名没有特殊意义。v0.0.1 数据可在内存中转换为组合模块；保存或编辑后写为 v0.1.0。原始笔记及稳定 ID 保留，旧 `itemRow` 子 ID 继续为 `:image`、`:text`。

打开 GUI 后，可新建、保存、另存 JSON，编辑文案、尺寸、图片缩放、布局和样式参数。多选模块可批量应用 Style；也可从模板添加模块、保存新 Style/Template、导出所选模块。预览与正式 PNG 使用同一渲染器。

## Agent 工作目录

目录可包含多份图片 JSON/PNG，打开任意 JSON 不要求 AGENTS.md 存在。Agent 使用的项目说明自行维护，应用不再提供项目初始化或 AGENTS.md 生成功能。图片 JSON 的协议见 [JSON_PROTOCOL.md](image_create_tool/resources/JSON_PROTOCOL.md)，可直接复制 [完整示例](image_create_tool/resources/example.image.json)。

运行中的 GUI 会发现外部文件变化，提供候选、合并与恢复。用户审阅前，内存编辑不覆盖外部文件，正式导出须先处理候选。历史仅在内存。

## 全局 Style 与 Template

全局配置默认在 Windows `%LOCALAPPDATA%/ImageCreateTool/settings.json`，其他系统在 `~/.config/ImageCreateTool/`。资源默认位于配置目录下的 `resources/styles/`、`resources/templates/`、`resources/scripts/`。

可在启动前用 `IMAGE_CREATE_TOOL_HOME` 环境变量选择配置目录，在 GUI“应用设置”中指定实际资源目录。验收时使用工作区配置：

```powershell
$env:IMAGE_CREATE_TOOL_HOME = Join-Path $PWD 'tool_test/app_config'
.venv/Scripts/python.exe -m image_create_tool
```

通过 GUI“批量应用 Style”“保存为新 Style”“从模板添加模块”“保存为新模板”管理资源。内置 `body`、`image-caption` 样式及 `image-caption` 模板可直接选择；模板的图片槽需填写素材。自定义资源优先从全局目录读取；保存新名称不覆盖已有资源。

Style 可描述最小模块或组合模块。组合 Style 按布局、位置和类型匹配，具体图文可以不同。应用是一次性整体覆盖：源参数及子样式展开写入目标图片 JSON，未给出的旧样式属性恢复默认；内容和 ID 不变。全局 Style 更新不会修改已有图片，用户重新应用才更新。JSON 中临时写 `"style": "body"` 也表示一次性应用请求，加载时通过受保护保存展开，后续不保留动态依赖。

Template 保存完整默认模块，新建/添加时复制并重新生成模块 ID，此后独立。保存可复用资源或另存图片时，实际素材、背景和字体引用会解析成明确路径，以免改变文件位置后误用素材。

## 素材、布局和绘制

在 GUI 中选择图片模块，使用“替换/选择素材”查询素材，使用“精确裁剪”“模块布局”“画布设置”“样式参数”调整效果。修改后先检查预览与问题提示，再点击“导出 PNG”；单独输出模块使用“导出所选模块”。

素材相对路径以 JSON 所在目录为基准。字体可通过 `fonts.regular/bold` 或文本 `style.font` 指定文件，Windows 默认微软雅黑。

外层按行排列；`layout: [行数, 列数]` 或 `column/row/grid/fixed` 支持嵌套。固定宽度占位后，自适应列默认均分余量，同行统一行高。图片 `contentScale` 缩小时，固定宽度模块保持宽度；自适应宽度随图片变窄，高度保留、图片垂直居中。容器可无背景或边框，各模块不继承样式。

每个模块均可有背景、边框、圆角、透明度与毛玻璃。背景先绘制，内容随后覆盖，子内容始终裁剪在所属容器内。文字超限仅产生 `TEXT_CLIPPED` 警告，保留原文并允许导出；素材缺失、无效裁剪、字体/处理脚本错误及布局越界阻止导出。

图片预处理在渲染工作线程调用全局 `scripts/` 中的函数，签名为 `process(image, **params)`，返回 Pillow 图片或 PNG 字节，结果仅在内存中。先处理脚本，再内置 crop，再适配与绘制。内置 `crop.py` 可作参考；自己的同名脚本优先。

## 终端与文件保护

GUI“打开终端”在当前 JSON 所在目录启动，Windows 默认 `pwsh`。在应用设置中指定程序，`terminalArgs` 是参数数组，可用 `{cwd}` 代入目录，例如 Windows Terminal 的 `-d` 参数。启动使用参数数组和实际工作目录，不拼接 shell 命令。

GUI 对同一个 JSON 使用独立会话锁，同目录不同 JSON 可分别打开。`.文件名.json.lock` 是复用的锁文件，不保存项目状态。写入期间通过同一个受保护句柄检查指纹并原地保存，不保证断电原子性。非法外部 JSON 不清空当前文档或覆盖源文件。

## 验收

使用 `tool_test/` 复制的真实素材，不运行旧绘图脚本。记录见 [重构验收](tool_test/REFACTOR_ACCEPTANCE.md)。仓库目前没有可收集的 pytest 测试；遵循 AGENTS.md，本次没有新增测试代码。
