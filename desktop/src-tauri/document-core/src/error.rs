//! Shared document errors and result type.
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentError {
    pub code: String,
    pub message: String,
}

impl DocumentError {
    pub(super) fn new(code: &str, message: impl ToString) -> Self {
        Self {
            code: code.into(),
            message: message.to_string(),
        }
    }
}

pub type Result<T> = std::result::Result<T, DocumentError>;

// Error equality lets polling suppress duplicate notifications.
impl PartialEq for DocumentError {
    fn eq(&self, other: &Self) -> bool {
        self.code == other.code && self.message == other.message
    }
}
