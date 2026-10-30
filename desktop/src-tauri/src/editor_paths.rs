//! Read-only file browsing for the bottom information area; never opens platform dialogs.
use creator_document_core::DocumentError;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

type Result<T> = std::result::Result<T, DocumentError>;
fn error(code: &str, message: impl ToString) -> DocumentError {
    DocumentError {
        code: code.into(),
        message: message.to_string(),
    }
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SelectionKind {
    Directory,
    Image,
    Json,
    SaveAs,
}

#[derive(Serialize)]
pub struct DirectoryEntry {
    name: String,
    path: String,
    directory: bool,
}
#[derive(Serialize)]
pub struct Location {
    label: String,
    path: String,
}
#[derive(Serialize)]
pub struct DirectoryListing {
    directory: String,
    parent: Option<String>,
    roots: Vec<Location>,
    entries: Vec<DirectoryEntry>,
    warnings: Vec<String>,
}

fn directory(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() {
        return Err(error("INVALID_DIRECTORY", "请填写完整目录路径"));
    }
    let directory = fs::canonicalize(path)
        .map_err(|e| error("INVALID_DIRECTORY", format!("{}：{e}", path.display())))?;
    if !directory.is_dir() {
        return Err(error("INVALID_DIRECTORY", "请选择已有目录"));
    }
    Ok(directory)
}

fn visible_file(kind: SelectionKind, path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    match kind {
        SelectionKind::Directory => false,
        SelectionKind::Image => ["png", "jpg", "jpeg", "webp", "svg"]
            .iter()
            .any(|s| extension.eq_ignore_ascii_case(s)),
        SelectionKind::Json | SelectionKind::SaveAs => extension.eq_ignore_ascii_case("json"),
    }
}

#[tauri::command]
pub async fn browse_editor_directory(
    app: AppHandle,
    kind: SelectionKind,
    path: Option<String>,
) -> Result<DirectoryListing> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| error("INVALID_DIRECTORY", e))?;
    tauri::async_runtime::spawn_blocking(move || {
        let current = directory(path.as_deref().map(Path::new).unwrap_or(&home))?;
        let mut roots = vec![Location {
            label: "用户目录".into(),
            path: home.to_string_lossy().into_owned(),
        }];
        #[cfg(windows)]
        for letter in b'A'..=b'Z' {
            let path = format!("{}:\\", char::from(letter));
            if Path::new(&path).is_dir() {
                roots.push(Location {
                    label: path.clone(),
                    path,
                });
            }
        }
        #[cfg(not(windows))]
        roots.push(Location {
            label: "文件系统".into(),
            path: "/".into(),
        });
        let mut entries = Vec::new();
        let mut warnings = Vec::new();
        for item in fs::read_dir(&current).map_err(|e| error("BROWSE_FAILED", e))? {
            let item = match item {
                Ok(item) => item,
                Err(e) => {
                    warnings.push(e.to_string());
                    continue;
                }
            };
            let metadata = match fs::metadata(item.path()) {
                Ok(metadata) => metadata,
                Err(e) => {
                    warnings.push(format!("{}：{e}", item.path().display()));
                    continue;
                }
            };
            let is_directory = metadata.is_dir();
            if !is_directory && (!metadata.is_file() || !visible_file(kind, &item.path())) {
                continue;
            }
            entries.push(DirectoryEntry {
                name: item.file_name().to_string_lossy().into_owned(),
                path: item.path().to_string_lossy().into_owned(),
                directory: is_directory,
            });
        }
        entries.sort_by(|a, b| {
            b.directory
                .cmp(&a.directory)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(DirectoryListing {
            directory: current.to_string_lossy().into_owned(),
            parent: current.parent().map(|p| p.to_string_lossy().into_owned()),
            roots,
            entries,
            warnings,
        })
    })
    .await
    .map_err(|e| error("BROWSE_FAILED", e))?
}

#[tauri::command]
pub async fn resolve_editor_selection(
    kind: SelectionKind,
    directory: String,
    filename: String,
) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let parent = self::directory(Path::new(&directory))?;
        if kind == SelectionKind::Directory {
            return Ok(parent.to_string_lossy().into_owned());
        }
        if filename.trim().is_empty() {
            return Err(error("INVALID_NAME", "请填写或选择文件"));
        }
        if kind == SelectionKind::SaveAs {
            let name = Path::new(&filename);
            if name.file_name().and_then(|s| s.to_str()) != Some(filename.as_str())
                || filename
                    .chars()
                    .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
            {
                return Err(error("INVALID_NAME", "文件名不能包含路径分隔符或非法字符"));
            }
            let filename = if filename.to_ascii_lowercase().ends_with(".json") {
                filename
            } else {
                format!("{filename}.json")
            };
            let path = parent.join(filename);
            match fs::symlink_metadata(&path) {
                Ok(_) => {
                    return Err(error(
                        "FILE_EXISTS",
                        "目标已存在，请修改文件名或选择其他目录",
                    ));
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(error("INVALID_PATH", e)),
            }
            return Ok(path.to_string_lossy().into_owned());
        }
        let requested = parent.join(filename);
        if !requested.is_absolute() {
            return Err(error(
                "INVALID_PATH",
                "请填写完整文件路径，或当前目录中的相对路径",
            ));
        }
        let path = fs::canonicalize(requested).map_err(|e| error("INVALID_PATH", e))?;
        if !path.is_file() {
            return Err(error("INVALID_PATH", "请选择已有文件"));
        }
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| error("INVALID_PATH", e))?
}
