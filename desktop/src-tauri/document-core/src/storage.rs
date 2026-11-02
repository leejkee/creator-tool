//! File writes: create a new destination or atomically replace an existing file.
use crate::{DocumentError, ImageDocument, Result};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

pub(super) fn write_new(path: &Path, document: &ImageDocument) -> Result<Vec<u8>> {
    let bytes = document.encode()?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| {
            DocumentError::new(
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    "FILE_EXISTS"
                } else {
                    "WRITE_FAILED"
                },
                e,
            )
        })?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(DocumentError::new("WRITE_FAILED", error));
    }
    Ok(bytes)
}

pub(super) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| DocumentError::new("WRITE_FAILED", "Missing parent directory"))?;
    let permissions = fs::metadata(path)
        .map_err(|e| DocumentError::new("WRITE_FAILED", e))?
        .permissions();
    let mut attempt = 0_u64;
    let (temporary, mut file) = loop {
        let temp = parent.join(format!(
            ".creator-document-{}-{attempt}.tmp",
            std::process::id()
        ));
        match OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => break (temp, file),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && attempt < 100 => {
                attempt += 1;
            }
            Err(e) => return Err(DocumentError::new("WRITE_FAILED", e)),
        }
    };
    let result = (|| -> std::io::Result<()> {
        file.write_all(bytes)?;
        file.set_permissions(permissions)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|e| DocumentError::new("WRITE_FAILED", e))
}
