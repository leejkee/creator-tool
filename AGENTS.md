## Reference

- 当前产品行为：@docs/template.md
- 图片 JSON 协议：@image_create_tool/resources/JSON_PROTOCOL.md
- 开发说明：@docs/dev.md
- 代码规范：@docs/CODING_STANDARDS.md

## 当前版本 v0.1.0

- Python 包 `image_create_tool`；GUI、服务和 Pillow 渲染器在同一进程的不同线程运行。
- 使用工作区 `.venv/Scripts/python.exe`。GUI：`-m image_create_tool open <图片.json>`；校验：`validate --file <图片.json>`；导出：`render --file <图片.json>`。
- 每张图片独立 JSON，GUI 不查找项目或固定 pjt.json；默认 PNG 与该 JSON 同名、同目录。
- Agent 项目初始化：`init <目录>`，生成 AGENTS.md；已有说明不覆盖。
- Style/Template 是全局 JSON 参数资源。应用 Style 一次性整体覆盖，遗漏属性恢复默认，实际图文内容和稳定 ID 保留；参数展开写入图片，之后不随全局文件变化。
- Template 复制创建后独立。模块无父子样式继承；布局容器可不设视觉装饰。
- 稳定 ID 必须保留。兼容读取旧 itemRow 时保留 `:text`、`:image` 子 ID。
- 素材查询使用 `assets search --file <图片.json> --name <名称>` 或 `--directory <素材目录>`；不手动猜绝对素材路径。
- 未明确请求时不新增攻略结论、不改变用户推荐、不删减条件，保留完整 `sourceNotes`。
- 修改后先 validate、再 render。文字超限按模块边界裁剪，仅警告；缺素材、非法 crop、字体或处理脚本错误、布局越界仍阻止导出。
- 验收使用 tool_test/ 中已复制的素材；旧图片仅作参考，不运行旧渲染脚本。
- 机器全局配置位置可用 IMAGE_CREATE_TOOL_HOME 或 --config-dir 覆盖；验收时使用工作区内配置目录，避免改动用户全局资源。

## Rules

- 未经用户明确要求，不新增或修改测试代码。
