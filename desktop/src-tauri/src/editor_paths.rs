//! Filename rules shared by workspace documents and JSON template selection.
use creator_document_core::DocumentError;
use std::{
    fs,
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, DocumentError>;
fn error(message: impl ToString) -> DocumentError {
    DocumentError {
        code: "INVALID_DOCUMENT_PATH".into(),
        message: message.to_string(),
    }
}

pub(super) fn named_document_path(directory: &Path) -> Result<PathBuf> {
    let mut name = directory
        .file_name()
        .ok_or_else(|| error("图片 JSON 必须位于有名称的目录中"))?
        .to_os_string();
    name.push(".json");
    Ok(directory.join(name))
}

pub(super) fn validate_named_document(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(error("请使用图片 JSON 的完整路径"));
    }
    let directory = path
        .parent()
        .ok_or_else(|| error("图片 JSON 必须位于有名称的目录中"))?;
    let expected = named_document_path(directory)?;
    if !path.file_name().is_some_and(|name| {
        name.as_encoded_bytes().eq_ignore_ascii_case(
            expected
                .file_name()
                .expect("Named document has a filename")
                .as_encoded_bytes(),
        )
    }) {
        return Err(error(format!(
            "图片 JSON 必须与所在目录同名，请选择 {}",
            expected.display()
        )));
    }
    let metadata = fs::metadata(path).map_err(|e| error(format!("{}：{e}", path.display())))?;
    if !metadata.is_file() {
        return Err(error("请选择与所在目录同名的 JSON 文件"));
    }
    Ok(())
}
