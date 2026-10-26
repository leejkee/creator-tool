# 芈月真实数据调用示例

本目录的示例源码、JSON、说明及演示 PNG 纳入 Git；`.gitignore` 忽略 Rust `target/`、前端 `node_modules/`、构建输出及缓存。`Cargo.lock` 保留，用于复现依赖版本。已存在的本地构建产物可以继续使用，不再跟踪。

- `main.rs`：通过相对路径依赖调用真实 `creator-document-core`，只为旧芈月攻略做一次临时格式转换，不是产品通用迁移器。
- `miyue-v0.2.image.json`：转换后的图片文档，4 个顶层模块、83 个节点，素材目录相对本文件为 `../tool_test/assets`。
- 原始输入仍为 `tool_test/pjt.json`，程序核对其内容未改变。

从仓库根目录运行（需要 Rust）：

```sh
CARGO_TARGET_DIR=/tmp/creator-miyue-demo-target cargo run --manifest-path tmp/Cargo.toml --locked
```

构建产物以及每次运行生成的 JSON 和模块目录放在系统临时目录，避免将二进制与会话产物加入 Git。实际路径由程序打印；读取仓库位置依据 Cargo 清单目录，不依赖 `/workspace` 或运行时当前目录。

程序验证：旧示例无法反序列化为现有模型；转换为 v0.2.0 网格；构造 ImageDocument；原有 ID、文字与 sourceNotes 保留；19 个素材文件可读取；JSON 序列化往返一致；从转换模板创建新模块，并重新打开会话。Rust 业务校验已移除，不再调用 ImageDocument::validate。仓库中的 JSON 原件不会被改写。

旧 group 标题展开为文本子模块，itemRow 展开为图片及文字放置记录，column/row 布局转为网格二元组。仅支持这份数据实际使用的旧布局，不静默猜测其他布局。

本示例只验证图片描述对象和文件业务，未执行预览或 PNG 渲染。提交的 JSON 使用相对素材路径；运行时生成的临时 JSON 使用当前仓库的绝对素材路径。

## TS 图片处理实图示例

[image-tools-demo/](image-tools-demo/README.md) 保存安琪拉原图，以及通过真实 TS 工具生成的矩形裁剪、圆形裁剪、0.5 倍和 2 倍缩放、整图模糊及圆内清晰的局部模糊 PNG；附有参数、哈希记录和可重复运行脚本。

## Style 与 TS 处理声明示例

[style-image-caption/](style-image-caption/README.md) 包含上图下文 Style、应用前后的图片 JSON，以及先居中裁正方形、再保留清晰内切圆并模糊四角的 TS 脚本。文字居中加粗；process-image.ts 使用真实注册表将 JSON 中的 processors 字符串映射为函数，并执行处理链。
