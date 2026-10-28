# 本地字体与系统默认字体

Rust 使用 `fontdb` 读取本地字体家族，通过 Tauri 命令提供给 TS。字体枚举位于应用层，不放进 `creator-document-core`，不增加 JSON 业务校验。

## 枚举接口

- Rust：`list_local_font_families`，无参数，返回字符串数组。
- TS：`listLocalFontFamilies(): Promise<readonly string[]>`，入口为 `desktop/src/fonts/`。
- 返回已发现的字体家族名及本地化家族别名，去掉空名称、按完整名称去重并排序；不同字重或样式不会重复返回同一家族名。
- 使用 `fontdb` 的系统字体发现逻辑，支持 Windows、macOS 和 Linux 常见的系统及用户字体目录；具体目录由库按平台处理。
- 扫描放在 `spawn_blocking` 中，不占用 Tauri 异步执行线程。每次调用重新扫描，适合进入字体选择器或用户主动刷新时调用，不在每帧渲染时调用。
- 无法读取或解析的单个字体由 `fontdb` 跳过，返回已发现的结果；结果可能为空。扫描任务异常时命令拒绝，错误包含 `code: "FONT_ENUMERATION_FAILED"` 和 `message`。
- IPC 只返回家族名称，不传输字体文件或操作字体安装。当前没有字体变更监听或字体列表缓存。

```ts
import { listLocalFontFamilies } from "./fonts";
import { DEFAULT_FONT_FAMILY, resolveFontFamily } from "./render-input";

const families = await listLocalFontFamilies();
const defaultFamily = resolveFontFamily(); // "sans-serif"
// DEFAULT_FONT_FAMILY === "sans-serif"
```

## 渲染参数

系统字体选择使用文字模块的 `style.fontFamily`。省略时使用集中定义的 `DEFAULT_FONT_FAMILY = "sans-serif"`，由 WebView 选择系统无衬线字体及必要的字形回退；默认值不依赖枚举列表第一项，也不回写文档。

`resolveFontFamily(value)` 接受省略值或非空字符串；`null`、空白字符串及非字符串抛出字段错误。函数返回显式名称时保持原值，不扫描字体、不判断是否已经安装或包含所需字形。已有 `style.font` 字体文件引用保持其原有含义，不将路径当作本地字体家族名。

已确认：显式指定的字体在当前机器不可用时，回退系统默认 `sans-serif`，继续渲染并警告用户重新选择；不修改文档原始字段。当前 `resolveFontFamily` 不检测可用性，这一回退规则仍需接入后续 Engine。

后续 UI 可用枚举结果提供选择；选择保存为 `style.fontFamily`，选择系统默认时省略该字段。字体资源加载、可用性检测、缺字处理、Canvas 字体设置和完整渲染 Engine 尚未实现。本接口不保证枚举出的每个别名都能由所有 WebView 以相同方式匹配，需在实际渲染时处理可用性。

## 当前验证

已通过 Tauri 工程的 `cargo check --locked`、`cargo clippy --locked -- -D warnings` 和 `npm --prefix desktop run build`。在当前 Linux 环境直接调用实际枚举函数，获得 258 个非空、排序且去重的家族名；该数量取决于机器安装的字体，不作为固定要求。字体默认解析也已手动核对省略、显式名称及 `null`、空字符串等非法输入。

尚未在实际 Tauri 窗口中验收 IPC、字体选择或 Canvas 绘制，也未在 Windows、macOS 实机验证。未新增项目测试代码。
