<div align="center">
  <img src="docs/assets/logo.svg" width="96" height="96" alt="图片创作 Logo" />
  <h1>图片创作</h1>
  <p><strong>把想法，排成一张图片。</strong></p>
  <p>Creator Tool · 本地图片排版与 PNG 导出工具</p>
  <p>
    <img src="docs/assets/stack.svg" width="574" height="34" alt="技术栈：Tauri 2、Vue 3、TypeScript、Rust、Canvas" />
  </p>
  <p>
    <a href="#主要功能">主要功能</a> ·
    <a href="#界面演示">界面演示</a> ·
    <a href="#启动应用">启动应用</a> ·
    <a href="#使用方法">使用方法</a> ·
    <a href="#文档">文档</a>
  </p>
</div>

图片创作将文字、图片和矩形组织为模块，通过网格完成排版。你可以在桌面界面中编辑，也可以直接修改 JSON 文档，再预览并导出 PNG，适合制作说明卡片、信息长图和图文海报。

作品与素材保存在本地，每张图片对应一份独立的 JSON 文档。

## 主要功能

<table>
  <tr>
    <td width="50%">
      <strong>文字、图片与矩形</strong><br />
      在属性面板中编辑内容、尺寸、字体、颜色、背景、边框与圆角。
    </td>
    <td width="50%">
      <strong>网格与嵌套布局</strong><br />
      用行列、间距和内边距组织模块，支持新增、删除及调整父模块和位置。
    </td>
  </tr>
  <tr>
    <td>
      <strong>预览与 PNG 导出</strong><br />
      点击画布选择模块，应用修改后刷新预览，按设定的输出尺寸导出图片。
    </td>
    <td>
      <strong>工作区与模板</strong><br />
      按目录管理作品，从空白文档开始，或复制已有 JSON 模板继续创作。
    </td>
  </tr>
  <tr>
    <td>
      <strong>本地素材与系统字体</strong><br />
      通过系统窗口选择图片，保存时复制素材；支持选择本机已安装的字体。
    </td>
    <td>
      <strong>保存与文件保护</strong><br />
      支持手动保存、自动保存、未保存提醒，以及外部文件变化和渲染问题提示。
    </td>
  </tr>
</table>

## 界面演示

<p align="center">
  <img src="docs/assets/editor.png" width="1360" alt="图片创作的 Tauri 界面：左侧文档列表、中间作品预览、右侧模块属性、底部状态信息" />
</p>

<p align="center">
  <sub>当前桌面界面，使用仓库自带的「创作示例」。</sub>
</p>

## 启动应用

目前面向 Windows 桌面使用。从源码运行前，准备 Node.js 22.12+、Rust 的 MSVC 工具链、Microsoft C++ Build Tools 和 WebView2。安装步骤见 [Tauri Windows 环境说明](https://v2.tauri.app/start/prerequisites/#windows)。

在项目根目录打开终端：

```powershell
cd desktop
npm ci
npm run tauri dev
```

需要安装包时，在 `desktop/` 下执行：

```powershell
npm run tauri build
```

生成的 Windows 安装包位于 `desktop/src-tauri/target/release/bundle/`。安装后直接启动应用即可。

## 使用方法

1. **选择工作区**：启动后选择保存作品的目录；左侧会列出符合命名规则的文档。
2. **新建或打开作品**：点击「新建文档」输入名称，也可以选择已有 JSON 模板。
3. **组织内容**：新增文字、图片、矩形或布局模块，并设置父模块与行列位置。
4. **编辑并应用**：在预览中点击模块，在右侧修改属性，点击「应用修改」更新文档与预览。
5. **保存作品**：点击「保存」，或在左下角开启自动保存。新选择的图片会在保存时复制到当前文档目录。
6. **导出 PNG**：点击「导出 PNG」。图片保存在 JSON 同目录，文件名与 JSON 一致；已有同名图片时会提示是否覆盖。

想先体验界面，可以将工作区选为 [desktop/examples](desktop/examples)，打开「创作示例」。该示例不依赖外部图片。

### 工作区目录

文档必须是 `<目录>/<目录名>.json`，应用只扫描工作区的一级子目录。例如：

```text
我的工作区/
├─ 作品封面/
│  ├─ 作品封面.json
│  ├─ 配图.png
│  └─ 作品封面.png
└─ 说明卡片/
   └─ 说明卡片.json
```

只有其他名称 JSON 的目录不会出现在文档列表中。JSON 模板同样要求文件名与所在目录同名。

图片相对路径以 JSON 所在目录为基准。切换模块或文档前，按提示处理尚未应用、尚未保存的修改；保存和导出使用已应用的内容。底部信息区域会显示操作提示、错误和警告。

### 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl + S` | 保存已应用的修改 |
| `Ctrl + Shift + S` | 另存为 |
| `Esc` | 取消当前底部操作 |

## 文档

- [文档格式与文件管理](docs/document.md)
- [布局、渲染与输出](docs/rendering.md)
- [素材、字体与图片处理](docs/resources.md)
- [开发环境与构建检查](docs/development.md)
