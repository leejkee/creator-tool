当前协议：`image-create-tool-version: "v0.1.0"`。应用直接读取指定 JSON，不查找项目清单。

| 字段 | 说明 |
| --- | --- |
| `documentId` / `revision` | 图片稳定身份与非负整数版本；外部修改保留身份。 |
| `title` / `sourceNotes` | 图片名称与完整原始笔记。 |
| `assetsDir` | 素材目录，默认 `assets/`，相对路径以本 JSON 所在目录为基准。 |
| `fonts.regular` / `fonts.bold` | 可选字体文件路径；Windows 默认微软雅黑。单个文本可用 `style.font` 覆盖字体文件。 |
| `composition` | 画布 `width`、`height`（数字或 `"auto"`）、`padding`、`gap`、可选 `background`。默认透明背景。 |
| `modules` | 顶层模块数组；可用 `composition.moduleOrder` 指定全部顶层 ID 的顺序。 |

模块共有非空唯一 `id`、`type`，以及可选 `name`、`width/height`、`offsetX/offsetY`、`visible`、`locked`、`zIndex`。
尺寸不写或写 `"auto"` 表示自适应。容器 `type: "group"`，子模块放在 `elements`；最小模块为 `text/image/rect`。
布局可为 `[行数, 列数]`，子模块用 `position: [行, 列]`（从 0 开始）定位；或对象
`{"type":"column|row|grid|fixed","padding":0,"gap":16}`。`grid` 需 `rows/columns`，`fixed` 子模块用 `x/y`。
不同的行独立分列。扣除固定列宽和间距后，其余列默认均分，行高取该行最高模块，内容垂直居中。

- 文本：`text` 保存完整文字。`style` 可设置 `fontSize`、`font`（字体文件）、`bold`、`color`、`align`（left/center/right）、`lineHeight`。
- 图片：使用 `assetQuery: {"name":"素材名","category":"可选分类"}` 或 `assetId`（素材目录相对路径），也支持 `assetPath`。
  `fit` 为 `contain/cover/stretch/height/width`；后两者分别按高度/宽度等比缩放，另一方向居中裁剪或留白。
  `contentScale` 默认为 1，固定宽度缩图时保留占位，自适应宽度缩图时跟随显示宽度、高度保留并垂直居中。
  `crop: {"x":0,"y":0,"width":100,"height":100}` 基于预处理后的图片像素。
- 装饰：`style.background` 可为颜色或对象；对象 `type` 为 `solid/image/blur`，支持 `color/opacity`，图片背景支持素材引用和 `fit`。
  `blurRadius` 仅模糊底层背景，未指定背景图时模糊该模块背后的底图。`style.radius` 控制圆角；
  `style.border` 支持 `visible/width/color`，`style.opacity` 为 0–1。
- 预处理：`processor: {"script":"crop.py","function":"process","params":{}}`，或 `processors` 数组。
  脚本放在全局资源目录 `scripts/`，函数签名为 `process(image, **params)`，返回 Pillow RGBA 图片或 PNG 字节。
  在渲染工作线程执行，先预处理后 crop，再做适配与绘制；不写原图或中间文件。

`style` 通常是本模块独立参数对象，也可暂写全局样式名称（如 `"style_1"`）作为一次性应用请求。
加载该请求时解析全局 Style 及子 Style，将参数展开保存到图片 JSON。正常预览不重新应用源样式。
Style 文件可直接包含视觉字段，也可用 `style` 对象，另可包含 `type/layout/width/height/fit/contentScale/elements`。
组合 Style 按布局、位置与类型匹配；应用整体替换样式，未指定字段恢复默认，图文内容及 ID 不变。
Template 文件为 `{"module": {...完整默认模块...}}`，新建时复制且重建模块 ID，此后独立。

文件读取失败不能覆盖原文件。GUI 外部候选需审阅后保存；正式导出须先解决未决候选。
文字超限仅在模块内裁剪，保留原文并允许导出；缺失素材、非法 crop、字体/脚本错误、容器越界阻止导出。
整图默认导出为 JSON 同名 PNG；`render --element <id>` 默认导出为 `JSON名_模块ID.png`，避免覆盖整图。
