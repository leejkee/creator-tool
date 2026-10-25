//! Standalone module resources. Styles describe parameters for one-shot application.
//! Application is implemented in style_application; resource file I/O is separate.
use crate::{ImageProcessor, Node, PlacedModule};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModuleType {
    Text,
    Image,
    Rect,
    Group,
}

/// Reuses module geometry and visual parameters, without requiring content or IDs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StyleNode {
    #[serde(rename = "type")]
    pub kind: ModuleType,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<PlacedModule<StyleNode>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<(u32, u32)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub processors: Vec<ImageProcessor>,
    /// Width, height, fit and other render parameters remain extensible.
    #[serde(flatten)]
    pub properties: Map<String, Value>,
}

/// The single root tag distinguishes actual module data from a reusable Style.
/// This resource envelope is separate from the full ImageDocument/session format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "resourceKind", content = "module", rename_all = "camelCase")]
pub enum ModuleResource {
    Image(Node),
    Style(StyleNode),
}
