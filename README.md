# 一图流攻略编辑器 v0.0.1

PySide6 桌面 GUI、Python 服务线程和 Pillow 渲染线程组成一个应用进程。工作目录根部的 `pjt.json` 是唯一项目文件；预览和导出使用相同绘图代码。

## 安装与运行（Windows PowerShell）

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m image_create_tool open --project tool_test
```

可在 GUI 中打开其他工作目录。新目录默认素材位置为 `assets/`，输出位置为 `outputs/`；通过“项目设置”修改。默认使用 Windows 微软雅黑，其他系统或自定义字体需在 JSON 中设置 `fonts.regular`（及可选 `fonts.bold`）为字体文件路径。

## Agent 与命令行

Agent 按文档协议修改工作目录唯一的 `pjt.json`。运行中的 GUI 会发现文件变化并提供外部候选预览、合并或恢复，不自行覆盖用户内容。

```powershell
.\.venv\Scripts\python.exe -m image_create_tool assets search --project tool_test --name 芈月
.\.venv\Scripts\python.exe -m image_create_tool validate --project tool_test
.\.venv\Scripts\python.exe -m image_create_tool render --project tool_test --output outputs\guide.png
.\.venv\Scripts\python.exe -m pip install pytest
.\.venv\Scripts\python.exe -m pytest
```

首版支持 `text/image/rect/group/itemRow`；模块和组合支持 `column/row/fixed` 布局，稳定子元素 ID 为 `itemRow_id:text` 与 `itemRow_id:image`。文档模型见 [服务设计](docs/PYTHON_SERVICE.md)，可复制 [示例项目](examples/basic/pjt.json)。`image.assetQuery.name` 自动按文件名匹配，确定后 GUI 编辑保存时写入相对路径 `assetId`；别名可通过 `assetAliases` 配置，键为素材相对路径。

也可以用 `pip install -e ".[test]"` 安装 `guide-editor` 命令；直接使用上述模块入口不需要构建工具。

GUI 属性面板可改文案、字号、颜色、尺寸和偏移，拖动画布元素可调整偏移。项目/画布/布局配置、素材选择、裁剪、复制删除、模块重排、撤销重做和导出均从 GUI 操作。首版画布/布局/裁剪精确配置采用 JSON 参数对话框。

## 文件保护与限制

GUI 保存 `pjt.json` 时短暂取得 Windows deny-write/delete 文件句柄。外部文件被占用时保留内存修改，使用“保存/重试”恢复；保护期间原地写入不提供断电/崩溃原子保存保证。历史只存在内存，关闭后清空。外部候选未处理前不导出；明显并行写入不属于首版使用方式。

资源缺失、裁剪越界、文字/画布溢出或字体缺失会报告问题；含占位的预览不可正式导出。对照图片位于 `outputs/reference/`，实际验收工程位于 `tool_test/`。

