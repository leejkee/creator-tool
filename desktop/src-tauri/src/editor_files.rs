//! Desktop file boundary for the editor. No rendering parameter validation here.
use crate::{documents, render_assets};
use creator_document_core::{DocumentError, ImageDocument, Node, Snapshot};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

type Result<T> = std::result::Result<T, DocumentError>;
static NEXT_FILE: AtomicU64 = AtomicU64::new(0);
fn error(code: &str, message: impl ToString) -> DocumentError {
    DocumentError {
        code: code.into(),
        message: message.to_string(),
    }
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorConfig {
    pub workspace: Option<String>,
    #[serde(default)]
    pub autosave: bool,
}

fn config_path(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_config_dir()
        .map(|p| p.join("editor.json"))
        .map_err(|e| error("CONFIG_FAILED", e))
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| error("WRITE_FAILED", e))?;
    if let Err(e) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error("WRITE_FAILED", e));
    }
    Ok(())
}

fn replace_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let temporary = path.with_file_name(format!(
        ".creator-save-{}-{}.tmp",
        std::process::id(),
        NEXT_FILE.fetch_add(1, Ordering::Relaxed)
    ));
    write_new(&temporary, bytes)?;
    let result = fs::rename(&temporary, path).map_err(|e| error("WRITE_FAILED", e));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
pub fn load_editor_config(app: AppHandle) -> Result<EditorConfig> {
    let path = config_path(&app)?;
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| error("CONFIG_FAILED", e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(EditorConfig::default()),
        Err(e) => Err(error("CONFIG_FAILED", e)),
    }
}

#[tauri::command]
pub fn save_editor_config(app: AppHandle, config: EditorConfig) -> Result<()> {
    if let Some(path) = &config.workspace
        && !Path::new(path).is_dir()
    {
        return Err(error("INVALID_DIRECTORY", "工作目录不存在"));
    }
    let path = config_path(&app)?;
    fs::create_dir_all(path.parent().expect("Config parent exists"))
        .map_err(|e| error("CONFIG_FAILED", e))?;
    replace_file(
        &path,
        &serde_json::to_vec_pretty(&config).map_err(|e| error("CONFIG_FAILED", e))?,
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    name: String,
    directory: String,
    candidates: Vec<String>,
    preferred: Option<String>,
}

#[tauri::command]
pub async fn scan_editor_workspace(workspace: String) -> Result<Vec<WorkspaceEntry>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut entries = Vec::new();
        for child in fs::read_dir(&workspace).map_err(|e| error("SCAN_FAILED", e))? {
            let child = child.map_err(|e| error("SCAN_FAILED", e))?;
            if !child
                .file_type()
                .map_err(|e| error("SCAN_FAILED", e))?
                .is_dir()
            {
                continue;
            }
            let name = child.file_name().to_string_lossy().into_owned();
            let mut candidates = Vec::new();
            for file in fs::read_dir(child.path()).map_err(|e| error("SCAN_FAILED", e))? {
                let file = file.map_err(|e| error("SCAN_FAILED", e))?;
                if file
                    .file_type()
                    .map_err(|e| error("SCAN_FAILED", e))?
                    .is_file()
                    && file
                        .path()
                        .extension()
                        .is_some_and(|s| s.eq_ignore_ascii_case("json"))
                {
                    candidates.push(file.path().to_string_lossy().into_owned());
                }
            }
            candidates.sort();
            if candidates.is_empty() {
                continue;
            }
            let preferred = candidates
                .iter()
                .find(|p| Path::new(p).file_stem().is_some_and(|s| s == name.as_str()))
                .cloned()
                .or_else(|| (candidates.len() == 1).then(|| candidates[0].clone()));
            entries.push(WorkspaceEntry {
                name,
                directory: child.path().to_string_lossy().into_owned(),
                candidates,
                preferred,
            });
        }
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(entries)
    })
    .await
    .map_err(|e| error("SCAN_FAILED", e))?
}

#[tauri::command]
pub async fn choose_editor_path(
    app: AppHandle,
    kind: String,
    initial: Option<String>,
) -> Result<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if let Some(directory) = initial {
            dialog = dialog.set_directory(directory);
        }
        let result = match kind.as_str() {
            "directory" => dialog.set_title("选择工作目录").blocking_pick_folder(),
            "image" => dialog
                .set_title("选择本地图片")
                .add_filter("图片", &["png", "jpg", "jpeg", "webp", "svg"])
                .blocking_pick_file(),
            "json" => dialog
                .set_title("选择 JSON 模板")
                .add_filter("JSON", &["json"])
                .blocking_pick_file(),
            "saveAs" => dialog
                .set_title("文档另存为")
                .add_filter("JSON", &["json"])
                .set_file_name("图片.json")
                .blocking_save_file(),
            _ => return Err(error("INVALID_ARGUMENT", "未知的文件选择方式")),
        };
        result
            .map(|p| {
                p.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(|e| error("INVALID_PATH", e))
            })
            .transpose()
    })
    .await
    .map_err(|e| error("DIALOG_FAILED", e))?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingAsset {
    module_id: String,
    slot: String,
    source_path: String,
    version: String,
}

fn node_mut<'a>(doc: &'a mut ImageDocument, id: &str) -> Result<&'a mut Node> {
    let mut pending: Vec<_> = doc.modules.iter_mut().collect();
    while let Some(node) = pending.pop() {
        if node.id == id {
            return Ok(node);
        }
        pending.extend(node.children.iter_mut().map(|p| &mut p.module));
    }
    Err(error("NODE_NOT_FOUND", id))
}

fn set_asset(doc: &mut ImageDocument, asset: &PendingAsset, path: String) -> Result<()> {
    let node = node_mut(doc, &asset.module_id)?;
    match asset.slot.as_str() {
        "image" => {
            node.properties
                .insert("assetPath".into(), Value::String(path));
        }
        "background" => {
            let background = node
                .properties
                .get_mut("style")
                .and_then(Value::as_object_mut)
                .and_then(|s| s.get_mut("background"))
                .and_then(Value::as_object_mut)
                .ok_or_else(|| error("INVALID_ARGUMENT", "图片背景已改变"))?;
            background.insert("assetPath".into(), Value::String(path));
        }
        _ => return Err(error("INVALID_ARGUMENT", "未知素材属性")),
    }
    Ok(())
}

#[tauri::command]
pub async fn save_editor_document(
    app: AppHandle,
    session_id: String,
    expected_version: u64,
    document: Value,
    assets: Vec<PendingAsset>,
    destination: Option<String>,
) -> Result<Snapshot> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<documents::Documents>();
        let result = documents::with_store(&state, |store| {
            let snapshot = store.get(&session_id)?;
            if snapshot.version != expected_version {
                return Err(error("STALE_VERSION", "文件状态已变化，请先处理外部修改"));
            }
            let mut doc = ImageDocument::from_value(document)?;
            let source_directory = snapshot.path.parent().expect("Document parent exists");
            let target = destination.map(PathBuf::from);
            let target_directory = target
                .as_ref()
                .and_then(|p| p.parent())
                .unwrap_or(source_directory);
            let target_directory =
                fs::canonicalize(target_directory).map_err(|e| error("INVALID_DIRECTORY", e))?;
            if !target_directory.is_dir() {
                return Err(error("INVALID_DIRECTORY", "请选择已有目录"));
            }
            let asset_directory = target_directory.join("assets");
            let mut created = Vec::new();
            let result = (|| {
                for asset in &assets {
                    let source = render_assets::read(
                        &asset.source_path,
                        &source_directory.to_string_lossy(),
                    )
                    .map_err(|e| {
                        error("ASSET_COPY_FAILED", format!("{}: {e:?}", asset.source_path))
                    })?;
                    if source.version != asset.version {
                        return Err(error(
                            "RESOURCE_CHANGED",
                            "素材已在预览后发生变化，请重新应用再保存",
                        ));
                    }
                    fs::create_dir_all(&asset_directory)
                        .map_err(|e| error("ASSET_COPY_FAILED", e))?;
                    let actual_directory = fs::canonicalize(&asset_directory)
                        .map_err(|e| error("ASSET_COPY_FAILED", e))?;
                    if !actual_directory.starts_with(&target_directory) {
                        return Err(error(
                            "ASSET_COPY_FAILED",
                            "assets 目录不能指向文档目录之外",
                        ));
                    }
                    let file = Path::new(&asset.source_path)
                        .file_name()
                        .ok_or_else(|| error("INVALID_PATH", "素材文件名为空"))?;
                    let file = Path::new(file);
                    let stem = file.file_stem().unwrap_or_default().to_string_lossy();
                    let extension = file
                        .extension()
                        .map(|s| format!(".{}", s.to_string_lossy()))
                        .unwrap_or_default();
                    let mut number = 0u64;
                    let copied = loop {
                        let name = if number == 0 {
                            format!("{stem}{extension}")
                        } else {
                            format!("{stem}_{number}{extension}")
                        };
                        let path = asset_directory.join(&name);
                        match OpenOptions::new().write(true).create_new(true).open(&path) {
                            Ok(mut output) => {
                                created.push(path.clone());
                                output
                                    .write_all(&source.bytes)
                                    .and_then(|_| output.sync_all())
                                    .map_err(|e| error("ASSET_COPY_FAILED", e))?;
                                break path;
                            }
                            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                                number += 1;
                            }
                            Err(e) => return Err(error("ASSET_COPY_FAILED", e)),
                        }
                    };
                    let reference = if target.is_some() {
                        copied.to_string_lossy().into_owned()
                    } else {
                        format!(
                            "assets/{}",
                            copied
                                .file_name()
                                .expect("Copied file name")
                                .to_string_lossy()
                        )
                    };
                    set_asset(&mut doc, asset, reference)?;
                }
                let dest = target
                    .as_ref()
                    .map(|p| {
                        let name = p
                            .file_name()
                            .and_then(|s| s.to_str())
                            .ok_or_else(|| error("INVALID_NAME", "无效的目标文件名"))?;
                        Ok((
                            p.parent()
                                .ok_or_else(|| error("INVALID_DIRECTORY", "请选择目标目录"))?,
                            name,
                        ))
                    })
                    .transpose()?;
                store.save_working_copy(&session_id, expected_version, doc, dest)
            })();
            if result.is_err() {
                for path in created {
                    let _ = fs::remove_file(path);
                }
            }
            result
        });
        if let Ok(snapshot) = documents::with_store(&state, |s| s.get(&session_id)) {
            documents::publish(&app, &snapshot);
        }
        result
    })
    .await
    .map_err(|e| error("SAVE_FAILED", e))?
}

#[derive(Serialize)]
pub struct PngDestination {
    path: String,
    version: Option<String>,
}

fn png_target(snapshot: &Snapshot) -> PathBuf {
    snapshot.path.with_extension("png")
}
fn png_version(path: &Path) -> Result<Option<String>> {
    if !path.exists() {
        return Ok(None);
    }
    render_assets::read(
        &path.to_string_lossy(),
        &path.parent().expect("PNG parent").to_string_lossy(),
    )
    .map(|asset| Some(asset.version))
    .map_err(|e| error("PNG_SAVE_FAILED", format!("{e:?}")))
}

#[tauri::command]
pub fn editor_png_destination(app: AppHandle, session_id: String) -> Result<PngDestination> {
    documents::with_store(&app.state::<documents::Documents>(), |s| {
        let target = png_target(&s.get(&session_id)?);
        Ok(PngDestination {
            path: target.to_string_lossy().into_owned(),
            version: png_version(&target)?,
        })
    })
}

#[tauri::command]
pub async fn write_editor_png(
    app: AppHandle,
    session_id: String,
    expected_version: u64,
    bytes: Vec<u8>,
    overwrite_version: Option<String>,
) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<documents::Documents>();
        let result = documents::with_store(&state, |s| {
            let snapshot = s.check(&session_id)?;
            if snapshot.version != expected_version || snapshot.external_change.is_some() {
                return Err(error("EXTERNAL_CHANGE", "文档状态已变化，请重新处理后导出"));
            }
            if !bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
                return Err(error("PNG_SAVE_FAILED", "无效的 PNG 数据"));
            }
            let target = png_target(&snapshot);
            if png_version(&target)? != overwrite_version {
                return Err(error("TARGET_CHANGED", "目标 PNG 已变化，请重新确认覆盖"));
            }
            let canonical = fs::canonicalize(&target).ok();
            let mut pending: Vec<_> = snapshot.document.modules.iter().collect();
            while let Some(node) = pending.pop() {
                let paths = [
                    node.properties.get("assetPath"),
                    node.properties
                        .get("style")
                        .and_then(|s| s.get("background"))
                        .and_then(|b| b.get("assetPath")),
                ];
                for path in paths.into_iter().flatten().filter_map(Value::as_str) {
                    if canonical.is_some()
                        && fs::canonicalize(snapshot.path.parent().expect("JSON parent").join(path))
                            .ok()
                            == canonical
                    {
                        return Err(error(
                            "SOURCE_OVERWRITE",
                            "导出目标正在作为素材使用，不能覆盖",
                        ));
                    }
                }
                pending.extend(node.children.iter().map(|p| &p.module));
            }
            if overwrite_version.is_some() {
                replace_file(&target, &bytes)?;
            } else {
                write_new(&target, &bytes)?;
            }
            Ok(target.to_string_lossy().into_owned())
        });
        if let Ok(snapshot) = documents::with_store(&state, |s| s.get(&session_id)) {
            documents::publish(&app, &snapshot);
        }
        result
    })
    .await
    .map_err(|e| error("PNG_SAVE_FAILED", e))?
}
