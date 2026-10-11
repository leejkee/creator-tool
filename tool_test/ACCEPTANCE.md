# 新应用第一版：真实笔记出图验收

2026-10-10，由验收子 Agent 在应用实现完成后执行。未运行旧项目的 `make.py` 或 `build_guides.py`。

## 输入与来源

原笔记：`C:/Users/31305/Documents/workspace/video-creator/wxq_anqila/script.md`。选择“逐鹿芈月c”对应表格行和 `## 芈月` 全部内容。原始三套笔记完整保存在唯一项目文件 `pjt.json` 的 `sourceNotes` 字段。

素材：`tool_test/assets/`，原样复制自旧项目。文案继续使用笔记中的简称；素材查询仅做对应：干将→干将莫邪、牛→牛魔、奕星→弈星、小明→明世隐、太乙→太乙真人、苍穹→纯净苍穹、大书→贤者之书、吸血书→噬神之书、磐岩之心→磐石之心。

## 内容对照

| 新图模块 | 笔记依据 |
| --- | --- |
| 01 安琪拉 / 逐鹿芈月c | “3级的神秘力量…”、三种推荐顿悟、烂分/保上分/难第一/ban河洛、同行限制与觉醒牌时机 |
| 02 前期开局与运营 | 表格中的速3/升4路线；干将、牛、奕星打连胜；3级d觉醒芈月；白起、西施工具卡 |
| 03 装备说明 | 必要苍穹、推荐大书、最后一件可选择吸血书/聚灵法杖/磐岩之心（针对海月） |
| 04 可选辅助 | 小明来的多才考虑、瑶不ban大河推荐、太乙后期必上、钟馗针对单c、老夫子打合成给战术牌 |

逐条核对 `## 芈月` 非空行（剥离 Markdown 项目标记）在输出文案中均存在；没有新增玩法结论、删减条件或改写推荐。

## 执行与结果

```powershell
.\.venv\Scripts\python.exe tool_test/prepare_acceptance.py
.\.venv\Scripts\python.exe -m image_create_tool assets search --project tool_test --name 芈月
.\.venv\Scripts\python.exe -m image_create_tool validate --project tool_test
.\.venv\Scripts\python.exe -m image_create_tool render --project tool_test --output tool_test/outputs/01_逐鹿芈月_新应用.png
```

`prepare_acceptance.py` 仅构造新应用的 JSON 输入，不绘图。`validate` 与 `render` 均返回 `ok=true`、`exportable=true`、`issues=[]`。新图 **1600×3097**，4 个模块、19 个图片引用；高度由完整内容自动计算。旧图为 1600×2760，仅作视觉参考，不要求复刻像素排版。

生成图：`tool_test/outputs/01_逐鹿芈月_新应用.png`。已复制相同字节至根目录 `outputs/01_逐鹿芈月_新应用.png`，旧图在根目录 `outputs/reference/01_逐鹿芈月_一图流.png`。

已查看新图完整预览：中文和显式换行正确，长辅助说明自动换行，未见文字截断、组件重叠或错误素材。英雄使用原图展示区裁剪，装备使用图标区裁剪，均在原图边界内。所有图文可通过稳定元素 ID 回到项目内容。

本次验收证明真实笔记能够通过新 CLI 和新渲染库出图；没有在本次任务中逐项手工点击 GUI，不据此宣称 GUI 全部交互均已人工验收。

主 Agent 随后执行 `python -m tests.gui_acceptance_smoke`，使用真实 `tool_test/pjt.json` 加载 PySide6 窗口、检查四个模块与完整预览，保存界面截图 `outputs/editor-preview.png` 并关闭后台线程；测试前后项目 JSON 哈希不变。核心与 Qt 自动化测试共 16 项通过，包含 GUI 编辑及 PNG 导出。仍不将自动化检查描述为全部功能的人工点击验收。
