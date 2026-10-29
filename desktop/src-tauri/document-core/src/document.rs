//! Image document data, module placement and JSON serialization.
use crate::{DocumentError, ImageProcessor, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Grid placement is a breaking change from the Python image format.
pub const DOCUMENT_VERSION: &str = "v0.2.0";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ImageDocument {
    #[serde(rename = "image-create-tool-version")]
    pub format: String,
    #[serde(rename = "documentId")]
    pub document_id: String,
    pub revision: u64,
    pub composition: Map<String, Value>,
    pub modules: Vec<Node>,
    #[serde(flatten)]
    pub properties: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Node {
    pub id: String,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<PlacedModule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<(u32, u32)>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub processors: Vec<ImageProcessor>,
    #[serde(flatten)]
    pub properties: Map<String, Value>,
}

/// A module's location belongs to its parent container, not to the module content.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlacedModule<T = Node> {
    pub position: (u32, u32),
    pub module: T,
    #[serde(flatten)]
    pub properties: Map<String, Value>,
}

impl ImageDocument {
    pub fn from_value(value: Value) -> Result<Self> {
        serde_json::from_value(value).map_err(|e| DocumentError::new("INVALID_JSON", e))
    }
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
        serde_json::from_slice(bytes).map_err(|e| DocumentError::new("INVALID_JSON", e))
    }
    pub fn encode(&self) -> Result<Vec<u8>> {
        let mut bytes = serde_json::to_vec_pretty(self)
            .map_err(|e| DocumentError::new("SERIALIZE_FAILED", e))?;
        bytes.push(b'\n');
        Ok(bytes)
    }
}
