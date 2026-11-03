//! Local resource persistence. Rendering and recipe business rules stay in TypeScript.
use crate::{documents, editor_files};
use creator_document_core::{DocumentError, ImageDocument, Snapshot};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

type Result<T> = std::result::Result<T, DocumentError>;
static NEXT_RESOURCE: AtomicU64 = AtomicU64::new(0);
#[derive(Default)]
pub struct Library(pub Mutex<()>);

fn error(code: &str, message: impl ToString) -> DocumentError {
    DocumentError {
        code: code.into(),
        message: message.to_string(),
    }
}
fn version(bytes: &[u8]) -> String {
    let mut hash = DefaultHasher::new();
    bytes.hash(&mut hash);
    format!("{:016x}:{}", hash.finish(), bytes.len())
}
fn root(app: &AppHandle) -> Result<PathBuf> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| error("LIBRARY_FAILED", e))?
        .join("library");
    fs::create_dir_all(&path).map_err(|e| error("LIBRARY_FAILED", e))?;
    let root = fs::canonicalize(path).map_err(|e| error("LIBRARY_FAILED", e))?;
    let users = root.join("users");
    fs::create_dir_all(&users).map_err(|e| error("LIBRARY_FAILED", e))?;
    if !fs::canonicalize(&users)
        .map_err(|e| error("LIBRARY_FAILED", e))?
        .starts_with(&root)
    {
        return Err(error("INVALID_PATH", "资源目录不能指向资源库之外"));
    }
    Ok(root)
}
fn resource_path(root: &Path, id: &str) -> Result<PathBuf> {
    if !id.starts_with("user-")
        || id.len() > 100
        || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err(error("INVALID_RESOURCE", "无效的用户资源标识"));
    }
    let path = root.join("users").join(format!("{id}.json"));
    if let Ok(meta) = fs::symlink_metadata(&path)
        && (!meta.is_file() || meta.file_type().is_symlink())
    {
        return Err(error("INVALID_PATH", "资源必须是资源库内的普通文件"));
    }
    Ok(path)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResourceKind {
    Template,
    Style,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceData {
    id: String,
    name: String,
    kind: ResourceKind,
    payload: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    thumbnail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    preview_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    preview_error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRecord {
    #[serde(flatten)]
    data: ResourceData,
    version: String,
    built_in: bool,
}
fn builtins() -> Result<Vec<ResourceData>> {
    serde_json::from_str(include_str!("../resources/builtins.json"))
        .map_err(|e| error("LIBRARY_FAILED", e))
}
fn read_user(root: &Path, id: &str) -> Result<ResourceRecord> {
    let bytes = fs::read(resource_path(root, id)?).map_err(|e| error("RESOURCE_READ_FAILED", e))?;
    let mut data: ResourceData =
        serde_json::from_slice(&bytes).map_err(|e| error("RESOURCE_READ_FAILED", e))?;
    data.id = id.into();
    let payload =
        serde_json::to_vec(&data.payload).map_err(|e| error("RESOURCE_READ_FAILED", e))?;
    if data.thumbnail.as_ref().is_some_and(|thumbnail| {
        !thumbnail.starts_with("data:image/png;base64,") || thumbnail.len() > 2_000_000
    }) || data.thumbnail.is_some()
        && data.preview_version.as_deref() != Some(version(&payload).as_str())
    {
        data.thumbnail = None;
        data.preview_error = Some("资源内容已变化或缩略图无效，请更新预览".into());
    }
    Ok(ResourceRecord {
        data,
        version: version(&bytes),
        built_in: false,
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryContext {
    directory: String,
    demo_path: String,
}
#[tauri::command]
pub async fn library_context(app: AppHandle) -> Result<LibraryContext> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Library>();
        let _guard = state.0.lock().map_err(|e| error("LIBRARY_FAILED", e))?;
        let root = root(&app)?;
        let path = root.join("demo.png");
        let bytes = include_bytes!("../resources/demo.png");
        if fs::read(&path).ok().as_deref() != Some(bytes.as_slice()) {
            if path.exists() {
                editor_files::replace_file(&path, bytes)?;
            } else {
                editor_files::write_new(&path, bytes)?;
            }
        }
        Ok(LibraryContext {
            directory: root.to_string_lossy().into_owned(),
            demo_path: path.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|e| error("LIBRARY_FAILED", e))?
}
#[tauri::command]
pub async fn list_library_resources(app: AppHandle) -> Result<Vec<ResourceRecord>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Library>();
        let _guard = state.0.lock().map_err(|e| error("LIBRARY_FAILED", e))?;
        let root = root(&app)?;
        let mut entries = Vec::new();
        for data in builtins()? {
            let bytes = serde_json::to_vec(&data).map_err(|e| error("LIBRARY_FAILED", e))?;
            entries.push(ResourceRecord {
                data,
                version: version(&bytes),
                built_in: true,
            });
        }
        for child in fs::read_dir(root.join("users")).map_err(|e| error("LIBRARY_FAILED", e))? {
            let path = child.map_err(|e| error("LIBRARY_FAILED", e))?.path();
            if path.extension().is_none_or(|e| e != "json") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            match read_user(&root, id) {
                Ok(record) => entries.push(record),
                Err(e) => {
                    if let Ok(path) = resource_path(&root, id)
                        && let Ok(bytes) = fs::read(path)
                    {
                        entries.push(ResourceRecord {
                            data: ResourceData {
                                id: id.into(),
                                name: id.into(),
                                kind: ResourceKind::Template,
                                payload: Value::Null,
                                thumbnail: None,
                                preview_version: None,
                                preview_error: Some(e.message),
                            },
                            version: version(&bytes),
                            built_in: false,
                        });
                    }
                }
            }
        }
        entries.sort_by(|a, b| {
            b.built_in
                .cmp(&a.built_in)
                .then(a.data.name.cmp(&b.data.name))
        });
        Ok(entries)
    })
    .await
    .map_err(|e| error("LIBRARY_FAILED", e))?
}
#[tauri::command]
pub async fn read_library_resource(app: AppHandle, id: String) -> Result<ResourceRecord> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(data) = builtins()?.into_iter().find(|r| r.id == id) {
            let bytes = serde_json::to_vec(&data).map_err(|e| error("LIBRARY_FAILED", e))?;
            return Ok(ResourceRecord {
                data,
                version: version(&bytes),
                built_in: true,
            });
        }
        read_user(&root(&app)?, &id)
    })
    .await
    .map_err(|e| error("RESOURCE_READ_FAILED", e))?
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResource {
    id: Option<String>,
    name: String,
    kind: ResourceKind,
    payload: Value,
    thumbnail: Option<String>,
    preview_error: Option<String>,
    expected_version: Option<String>,
}
#[tauri::command]
pub async fn save_library_resource(
    app: AppHandle,
    request: SaveResource,
) -> Result<ResourceRecord> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Library>();
        let _guard = state.0.lock().map_err(|e| error("LIBRARY_FAILED", e))?;
        if request.name.trim().is_empty()
            || request.name.len() > 240
            || request.name.chars().any(char::is_control)
        {
            return Err(error(
                "INVALID_NAME",
                "资源名称不能为空、过长或包含控制字符",
            ));
        }
        if request
            .thumbnail
            .as_ref()
            .is_some_and(|s| !s.starts_with("data:image/png;base64,") || s.len() > 2_000_000)
        {
            return Err(error("INVALID_PREVIEW", "缩略图必须是有效大小的 PNG 数据"));
        }
        let root = root(&app)?;
        let id = request.id.unwrap_or_else(|| {
            format!(
                "user-{:x}-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos(),
                NEXT_RESOURCE.fetch_add(1, Ordering::Relaxed)
            )
        });
        let path = resource_path(&root, &id)?;
        let current = match fs::read(&path) {
            Ok(bytes) => Some(version(&bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(error("RESOURCE_READ_FAILED", e)),
        };
        if current != request.expected_version {
            return Err(error(
                "EXTERNAL_CHANGE",
                "资源已被修改或删除，请重新加载，或另存为用户副本",
            ));
        }
        let preview_version = request
            .thumbnail
            .as_ref()
            .map(|_| serde_json::to_vec(&request.payload).map(|bytes| version(&bytes)))
            .transpose()
            .map_err(|e| error("RESOURCE_SAVE_FAILED", e))?;
        let data = ResourceData {
            id,
            name: request.name.trim().into(),
            kind: request.kind,
            payload: request.payload,
            thumbnail: request.thumbnail,
            preview_version,
            preview_error: request.preview_error,
        };
        let bytes =
            serde_json::to_vec_pretty(&data).map_err(|e| error("RESOURCE_SAVE_FAILED", e))?;
        if current.is_some() {
            editor_files::replace_file(&path, &bytes)?;
        } else {
            editor_files::write_new(&path, &bytes)?;
        }
        Ok(ResourceRecord {
            data,
            version: version(&bytes),
            built_in: false,
        })
    })
    .await
    .map_err(|e| error("RESOURCE_SAVE_FAILED", e))?
}
#[tauri::command]
pub async fn library_resource_version(app: AppHandle, id: String) -> Result<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = resource_path(&root(&app)?, &id)?;
        match fs::read(path) {
            Ok(bytes) => Ok(Some(version(&bytes))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(error("RESOURCE_READ_FAILED", e)),
        }
    })
    .await
    .map_err(|e| error("RESOURCE_READ_FAILED", e))?
}
#[tauri::command]
pub async fn delete_library_resource(
    app: AppHandle,
    id: String,
    expected_version: String,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Library>();
        let _guard = state.0.lock().map_err(|e| error("LIBRARY_FAILED", e))?;
        let path = resource_path(&root(&app)?, &id)?;
        let bytes = fs::read(&path).map_err(|e| error("RESOURCE_READ_FAILED", e))?;
        if version(&bytes) != expected_version {
            return Err(error("EXTERNAL_CHANGE", "资源已发生变化，请刷新后重试"));
        }
        fs::remove_file(path).map_err(|e| error("RESOURCE_DELETE_FAILED", e))
    })
    .await
    .map_err(|e| error("RESOURCE_DELETE_FAILED", e))?
}
#[tauri::command]
pub async fn create_library_document(
    app: AppHandle,
    workspace: String,
    name: String,
    document: Value,
) -> Result<Snapshot> {
    tauri::async_runtime::spawn_blocking(move || {
        let document = ImageDocument::from_value(document)?;
        documents::with_store(&app.state::<documents::Documents>(), |store| {
            let result = store.create_from_document(
                Some(Path::new(&workspace)),
                None,
                &name,
                Some(document),
            )?;
            documents::publish(&app, &result);
            Ok(result)
        })
    })
    .await
    .map_err(|e| error("CREATE_FAILED", e))?
}
