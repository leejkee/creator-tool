mod system;

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct FontEnumerationError {
    code: &'static str,
    message: String,
}

#[tauri::command]
pub async fn list_local_font_families() -> Result<Vec<String>, FontEnumerationError> {
    tauri::async_runtime::spawn_blocking(system::list_families)
        .await
        .map_err(|error| FontEnumerationError {
            code: "FONT_ENUMERATION_FAILED",
            message: format!("Could not enumerate local fonts: {error}"),
        })
}
