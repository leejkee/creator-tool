//! Native file and directory selection; writing remains in the document file boundary.
use creator_document_core::DocumentError;
use serde::Deserialize;
use std::fs;
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
    Document,
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
            SelectionKind::Document => dialog
                .set_title("选择要打开的 JSON")
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
                if kind == SelectionKind::Document {
                    let directory = initial
                        .as_deref()
                        .ok_or_else(|| error("INVALID_DIRECTORY", "未指定文档目录"))?;
                    let directory =
                        fs::canonicalize(directory).map_err(|e| error("INVALID_DIRECTORY", e))?;
                    let parent = path
                        .parent()
                        .map(fs::canonicalize)
                        .transpose()
                        .map_err(|e| error("INVALID_DIRECTORY", e))?;
                    if parent.as_deref() != Some(directory.as_path())
                        || !path.is_file()
                        || !path
                            .extension()
                            .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
                    {
                        return Err(error(
                            "INVALID_PATH",
                            format!("请选择 {} 目录中的 JSON 文件", directory.display()),
                        ));
                    }
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
