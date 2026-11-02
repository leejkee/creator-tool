//! Native file and directory selection; writing remains in the document file boundary.
use crate::{editor_files, editor_paths};
use creator_document_core::DocumentError;
use serde::Deserialize;
use tauri::WebviewWindow;
use tauri_plugin_dialog::DialogExt;

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

#[tauri::command]
pub async fn choose_editor_path(
    window: WebviewWindow,
    kind: SelectionKind,
    initial: Option<String>,
) -> Result<Option<String>, DocumentError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = window.dialog().file().set_parent(&window);
        if let Some(directory) = &initial {
            dialog = dialog.set_directory(directory);
        }
        let selection = match kind {
            SelectionKind::Directory => dialog.set_title("选择工作目录").blocking_pick_folder(),
            SelectionKind::Image => dialog
                .set_title("选择本地图片")
                .add_filter("图片", &["png", "jpg", "jpeg", "webp", "svg"])
                .blocking_pick_file(),
            SelectionKind::Json => dialog
                .set_title("选择 JSON 模板")
                .add_filter("JSON", &["json"])
                .blocking_pick_file(),
            SelectionKind::SaveAs => dialog
                .set_title("文档另存为")
                .add_filter("JSON", &["json"])
                .set_file_name("图片.json")
                .blocking_save_file(),
        };
        selection
            .map(|selection| {
                let mut path = selection
                    .into_path()
                    .map_err(|e| error("INVALID_PATH", e))?;
                if kind == SelectionKind::Directory {
                    path = editor_files::ensure_workspace_writable(&path)?;
                }
                if kind == SelectionKind::Json {
                    editor_paths::validate_named_document(&path)?;
                }
                if kind == SelectionKind::SaveAs
                    && !path
                        .extension()
                        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
                {
                    path.as_mut_os_string().push(".json");
                }
                Ok(path.to_string_lossy().into_owned())
            })
            .transpose()
    })
    .await
    .map_err(|e| error("DIALOG_FAILED", e))?
}
