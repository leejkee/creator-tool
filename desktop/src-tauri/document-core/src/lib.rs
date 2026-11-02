//! Authoritative image document sessions, independent of Tauri and rendering.
mod document;
mod error;
mod grid;
mod lifecycle;
mod processors;
mod session;
mod storage;
mod style;
mod style_application;

pub use document::{DOCUMENT_VERSION, ImageDocument, Node, PlacedModule};
pub use error::{DocumentError, Result};
pub use processors::ImageProcessor;
pub use session::{DocumentStore, ExternalChange, Snapshot};
pub use style::{ModuleResource, StyleNode};
pub use style_application::apply_style;
