# 安琪拉图片处理示例

按照用户确认，原神 Logo 未能从当前可访问来源取得，改用仓库中的安琪拉素材。原图为 `tool_test/assets/安琪拉_棋手.png`，本目录 original.png 是其逐字节副本（544×544），没有重新绘制或替换内容。

main.ts 直接导入 `desktop/src/image-tools`，在浏览器 Canvas 环境中分别处理原图：

| 文件 | 实际调用参数 | 输出尺寸 |
| --- | --- | --- |
| rectangle.png | cropRectangle，x=96、y=32、width=352、height=384 | 352×384 |
| circle.png | cropCircle，radius=240，圆心为原图中心 | 480×480，圆外透明 |
| scale-half.png | scaleImage，ratio=0.5 | 272×272 |
| scale-double.png | scaleImage，ratio=2 | 1088×1088 |

各项处理均独立使用 original.png，没有先裁剪再缩放。results.json 记录源文件、输出尺寸、参数、SHA-256 和通过的检查项目。原图来源和仓库内原件均保持不变。

## 重复运行

需要 Node.js 22+、已安装 desktop 的 npm 依赖，以及 Chromium。Linux 环境可在仓库根目录执行：

```sh
npm --prefix desktop ci
node tmp/image-tools-demo/run.mjs
```

Chromium 不在 PATH 时，通过 CHROMIUM_PATH 指定可执行文件：

```sh
CHROMIUM_PATH=/usr/bin/chromium node tmp/image-tools-demo/run.mjs
```

run.mjs 启动仅监听回环地址的 Vite 服务和无头 Chromium，使用浏览器真实执行 TS 图片工具，通过 CDP 取回 Canvas 编码的 PNG，再由 Node 写入本目录。动态端口、浏览器配置目录和进程会在结束时清理，不保存构建缓存或浏览器资料到仓库。不需要额外的 Canvas 或浏览器自动化 npm 包。

这段脚本是开发期的实际素材演示，不是产品运行时的一部分，也未接入 Vue 编辑器或 Rust 文档会话。index.html 提供查看示例的临时页面，不改变应用界面。

本次执行通过 12 项检查：原图与四种输出尺寸、圆外透明/圆内保留像素、矩形裁剪逐像素对应原图区域，以及输入像素不变。运行后重新核对 original.png 与仓库源文件的字节哈希。
