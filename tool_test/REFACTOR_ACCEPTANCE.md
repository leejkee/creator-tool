# v0.1.0 重构验收

分支：`feat/style-template`。本记录对应本轮实际执行，不代表 GUI 所有按钮均已人工点击。
未新增或修改测试代码；`pytest --collect-only` 确认仓库没有可收集的测试。

本文中的 CLI 和 Agent 初始化结果属于历史验收；当前应用已移除这些入口，使用 GUI 打开、编辑和导出图片。

## 文件与素材

- 原始 `tool_test/pjt.json` 保持原样，仅作为普通 JSON 显式打开，没有运行旧绘图脚本。
- 素材继续使用已复制的 `tool_test/assets/`，通过新 CLI 查询“芈月”确认素材身份。
- 保留新功能演示 `refactor_project/layout.image.json`；独立模板实例、服务/GUI 编辑副本和路径验收目录已在提交前清理。
- 验收全局配置限定在工作区 `tool_test/app_config/`，没有写用户现有全局 Style/Template。
- 下表记录当时执行结果。生成的 PNG、GUI 截图和 wheel 属于可重建产物，不纳入版本控制；本地配置也不提交。

## 已执行

| 范围 | 实际结果 |
| --- | --- |
| 真实攻略 | `validate --file tool_test/pjt.json`、`render` 均成功，1600×3097，issues 为空；输出 `refactor_逐鹿芈月.png`。 |
| 样式整体应用 | 对两行一列图文组应用 image-caption，保留图文和 ID，原字体/颜色/背景及尺寸按新样式或默认值替换。 |
| 源 Style 独立 | 图片首次渲染后修改全局 captured-caption 的字号/颜色，再渲染的 PNG 哈希保持 `879DC56C2245A91974804DE212175AD8F186693EDDFBA2213D457FF5599410AE`；显式重新应用后字体才更新。 |
| 保存 Style/Template | 使用 CLI 保存当前模块为新 Style 和新 Template；Template 可创建独立 JSON，重新生成子 ID，并独立 validate、render 成功。保存资源解析素材与字体路径。 |
| 组合匹配 | 给文本模块应用图文组合 Style 返回 STYLE_MISMATCH、退出码 1，图片 JSON 哈希不变。 |
| 布局编辑 | 将图文组由两行一列调整为一行两列，保留子模块内容与 ID、重排位置，validate 与 render 成功。 |
| 缩图与绘制 | 演示包含固定宽度 300 的半尺寸图片，以及自适应宽度图片；后者宽约 78.79、高仍 220，显示图片垂直居中。已查看 PNG。 |
| 背景和裁剪 | 模块独立毛玻璃、透明背景、边框和圆角成功；72 号文字在 30 像素高模块内裁剪，返回 TEXT_CLIPPED 警告但允许导出，下方文字未被覆盖。 |
| 图片脚本 | 使用 crop.py/process 对真实素材在内存中裁剪，之后由渲染器适配；源素材未覆盖。 |
| 任意模块输出 | `render --element caption` 独立透明画布导出成功，其他模块的文本裁剪警告不影响该输出。 |
| 文件服务 | 打开 JSON、应用样式、撤销、重做；外部 Agent 修改生成候选，内存继续改颜色，合并无冲突，双方修改保留，后台导出成功，服务线程正常结束。 |
| GUI | Qt 离屏打开并预览；选择文本后修改颜色，自动保存到 JSON，调用 GUI 导出入口生成同目录 PNG；截图 `refactor_gui.png`，服务线程正常结束。 |
| Agent 初始化 | init 生成包含当前协议、示例、实际配置路径及 CLI 的 AGENTS.md，命令使用当前 Python 的绝对路径，支持直接在新终端使用；第二次 init 返回 created=false，保留原说明。 |
| 路径 | `refactor 空格目录/guide.json` 校验和同目录导出成功。 |
| 编译和打包 | compileall 通过；构建 v0.1.0 wheel，确认包含 Agent 模板、协议、JSON 示例、Style、Template 和脚本资源；工作区 .venv 可编辑安装成功。 |

## 常用复核命令

```powershell
$env:IMAGE_CREATE_TOOL_HOME = Join-Path $PWD 'tool_test/app_config'
.venv/Scripts/python.exe -m image_create_tool
```

在界面中打开 `tool_test/refactor_project/layout.image.json`，检查预览与问题提示，再导出 PNG。

## 验证边界

- 真实终端窗口尚未人工唤起；代码按参数数组设置 cwd，Windows 默认 pwsh，可配置程序及 `{cwd}` 参数。GUI 离屏不能代替用户终端配置的交互验收。
- GUI 的文件对话框、所有属性组合及资源对话框未逐项人工点击；本轮 GUI 实际检查为打开、预览、文本属性保存、导出和关闭。
- 预处理采用工作线程，没有子进程隔离或硬超时；这是本轮采用的实现方案。
- 未安装 Ruff/mypy，也未声称通过相应检查。构建缺少 setuptools 的问题通过安装仓库声明的构建依赖及 wheel 解决，未增加运行依赖。
