//! Local, read-only resource transport. Rendering and format handling stay in TypeScript.
use serde::Serialize;
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize)]
pub struct RenderAssetError {
    code: &'static str,
    message: String,
}

#[derive(Serialize)]
pub struct RenderAsset {
    bytes: Vec<u8>,
    version: String,
}

fn error(code: &'static str, message: impl ToString) -> RenderAssetError {
    RenderAssetError {
        code,
        message: message.to_string(),
    }
}

fn resolve(asset_path: &str, document_directory: &str) -> Result<PathBuf, RenderAssetError> {
    if asset_path.is_empty() || asset_path.contains('\0') || document_directory.contains('\0') {
        return Err(error(
            "INVALID_RENDER_CONTEXT",
            "Invalid local resource path",
        ));
    }
    let directory = Path::new(document_directory);
    if !directory.is_absolute() {
        return Err(error(
            "INVALID_RENDER_CONTEXT",
            "An absolute JSON directory is required",
        ));
    }
    let directory = fs::canonicalize(directory).map_err(|e| error("INVALID_RENDER_CONTEXT", e))?;
    if !directory.is_dir() {
        return Err(error(
            "INVALID_RENDER_CONTEXT",
            "The JSON directory is not a directory",
        ));
    }
    let reference = Path::new(asset_path);
    let path = if reference.is_absolute() {
        reference.to_path_buf()
    } else {
        directory.join(reference)
    };
    fs::canonicalize(path).map_err(|e| error("IMAGE_UNAVAILABLE", e))
}

fn read(asset_path: &str, document_directory: &str) -> Result<RenderAsset, RenderAssetError> {
    let path = resolve(asset_path, document_directory)?;
    let metadata = fs::metadata(&path).map_err(|e| error("IMAGE_UNAVAILABLE", e))?;
    if !metadata.is_file() {
        return Err(error(
            "IMAGE_UNAVAILABLE",
            "The resource is not a regular file",
        ));
    }
    let bytes = fs::read(&path).map_err(|e| error("IMAGE_UNAVAILABLE", e))?;
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    bytes.hash(&mut hasher);
    Ok(RenderAsset {
        version: format!("{:016x}:{}", hasher.finish(), bytes.len()),
        bytes,
    })
}

#[tauri::command]
pub async fn read_render_asset(
    asset_path: String,
    document_directory: String,
) -> Result<RenderAsset, RenderAssetError> {
    tauri::async_runtime::spawn_blocking(move || read(&asset_path, &document_directory))
        .await
        .map_err(|e| error("RESOURCE_PROVIDER_FAILED", e))?
}

#[tauri::command]
pub async fn get_render_asset_version(
    asset_path: String,
    document_directory: String,
) -> Result<Option<String>, RenderAssetError> {
    tauri::async_runtime::spawn_blocking(move || match read(&asset_path, &document_directory) {
        Ok(asset) => Ok(Some(asset.version)),
        Err(e) if e.code == "IMAGE_UNAVAILABLE" => Ok(None),
        Err(e) => Err(e),
    })
    .await
    .map_err(|e| error("RESOURCE_PROVIDER_FAILED", e))?
}
