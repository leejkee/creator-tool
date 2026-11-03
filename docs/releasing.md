# 发布

桌面应用通过 GitHub Releases 分发 Windows x64 的 NSIS 安装包。发布流程使用 [Tauri Action](https://github.com/tauri-apps/tauri-action)，先生成 Release 草稿，安装包和 SHA256 校验文件均上传成功后自动发布。前端依赖仍由 npm 管理，应用本身不发布到 npm。

## CI 与 Release

- [Desktop checks](../.github/workflows/ci.yml)：分支 push、Pull Request 和手动触发时执行前端检查与构建，以及 Windows Rust 格式检查、编译和 Clippy；不运行测试。
- [Release Windows](../.github/workflows/release.yml)：推送 `v*` 标签时触发，也可手动指定已有标签。先校验版本并固定提交，再复用 CI 检查该提交，通过后构建同一提交的安装包。
- 发布附件为 `CreatorTool_<版本>_windows_x64-setup.exe` 和 `SHA256SUMS.txt`。`v0.2.0-beta.1` 等预发布版本会标记为 prerelease，附件上传完成后同样自动发布，但不标记为 latest。

安装包构建和上传任务使用 GitHub 自动提供的 `GITHUB_TOKEN`，只有该任务授予 `contents: write`；其余任务仅有仓库读取权限。无需 npm 发布令牌。当前流程未接入 Windows 代码签名或应用内自动更新，更新时从 Releases 下载新安装包。

## 发布一个版本

1. 同步 `desktop/src-tauri/tauri.conf.json`、`desktop/package.json`、`desktop/src-tauri/Cargo.toml` 中的应用版本，并更新 npm 和 Cargo 锁文件。应用版本与图片 JSON 的格式版本独立管理。
2. 按[开发说明](development.md#检查)完成本地检查，提交版本和功能改动，推送包含发布工作流的提交。可将面向使用者的版本说明保存到 `.github/release-notes/<标签>.md`，发布时会使用该文件替换自动生成的说明。
3. 为该提交创建版本标签并推送。例如，版本为 `0.1.0` 时：

   ```powershell
   git tag -a v0.1.0 -m "图片创作 v0.1.0"
   git push origin v0.1.0
   ```

4. 在仓库 Actions 中查看 **Release Windows**。标签版本必须与应用配置、npm 包及锁文件、Rust 包版本一致，否则停止发布。
5. 构建完成后，工作流先上传安装包及校验文件，再将草稿转为正式 Release；稳定版本标记为 latest，预发布版本保留 prerelease 标识。任一步失败都不继续执行后续发布步骤。
6. 在 Releases 中下载附件并核对校验值，按项目安排检查安装与运行。推送版本标签即授权该版本在流水线成功后自动对外发布，应在推送前完成所需的版本检查和确认。

标签应指向已提交的版本；仅推送分支不会生成 Release。使用手动触发入口时，工作流须已合入默认分支，填写的标签也须包含这些工作流与脚本。

## 重跑与校验

构建失败时修复问题后发布新的提交与标签；同一标签的暂时网络或上传失败可重跑任务，已有草稿可继续上传。已正式发布的版本禁止覆盖，应递增应用版本并创建新标签。

下载后的校验方式：

```powershell
Get-FileHash -Algorithm SHA256 .\CreatorTool_0.1.0_windows_x64-setup.exe
```

将结果与同一 Release 的 `SHA256SUMS.txt` 比对。校验值用于核对下载内容，不能替代代码签名。

本地生成与 CI 相同类型的安装包，在 `desktop/` 下执行：

```powershell
npm ci
npm run tauri -- build --ci --target x86_64-pc-windows-msvc --bundles nsis -- --locked
```

安装包位于 `desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`。CI 上传时使用上述统一附件名，本地构建仍使用 Tauri 配置中的产品名。
