//! Authoritative image document sessions, independent of Tauri and rendering.
mod lifecycle;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentError {
    pub code: String,
    pub message: String,
}
impl DocumentError {
    fn new(code: &str, message: impl ToString) -> Self {
        Self {
            code: code.into(),
            message: message.to_string(),
        }
    }
}
pub type Result<T> = std::result::Result<T, DocumentError>;

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
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub elements: Vec<Node>,
    #[serde(flatten)]
    pub properties: Map<String, Value>,
}

impl ImageDocument {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
        let document: Self =
            serde_json::from_slice(bytes).map_err(|e| DocumentError::new("INVALID_JSON", e))?;
        document.validate()?;
        Ok(document)
    }
    pub fn validate(&self) -> Result<()> {
        if self.format != "v0.1.0" {
            return Err(DocumentError::new("UNSUPPORTED_FORMAT", &self.format));
        }
        if self.document_id.trim().is_empty() {
            return Err(DocumentError::new(
                "INVALID_DOCUMENT",
                "documentId must not be empty",
            ));
        }
        fn visit(nodes: &[Node], ids: &mut HashSet<String>) -> Result<()> {
            for node in nodes {
                if node.id.trim().is_empty() || !ids.insert(node.id.clone()) {
                    return Err(DocumentError::new("INVALID_NODE_ID", &node.id));
                }
                if !matches!(node.kind.as_str(), "text" | "image" | "rect" | "group") {
                    return Err(DocumentError::new("INVALID_NODE_TYPE", &node.kind));
                }
                if node.kind != "group" && !node.elements.is_empty() {
                    return Err(DocumentError::new(
                        "INVALID_NODE",
                        format!("{}: leaf has children", node.id),
                    ));
                }
                if node.kind == "text" && !node.properties.get("text").is_some_and(Value::is_string)
                {
                    return Err(DocumentError::new(
                        "INVALID_NODE",
                        format!("{}: text must be a string", node.id),
                    ));
                }
                visit(&node.elements, ids)?;
            }
            Ok(())
        }
        visit(&self.modules, &mut HashSet::new())
    }
    pub fn encode(&self) -> Result<Vec<u8>> {
        self.validate()?;
        let mut bytes = serde_json::to_vec_pretty(self)
            .map_err(|e| DocumentError::new("SERIALIZE_FAILED", e))?;
        bytes.push(b'\n');
        Ok(bytes)
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExternalChange {
    Modified {
        document: Option<ImageDocument>,
        error: Option<DocumentError>,
    },
    Missing,
    Unreadable {
        error: DocumentError,
    },
}
// Error equality lets polling suppress duplicate notifications.
impl PartialEq for DocumentError {
    fn eq(&self, other: &Self) -> bool {
        self.code == other.code && self.message == other.message
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub session_id: String,
    pub path: PathBuf,
    pub working_directory: PathBuf,
    pub document: ImageDocument,
    pub version: u64,
    pub dirty: bool,
    pub external_change: Option<ExternalChange>,
}
struct Session {
    state: Snapshot,
    baseline_document: ImageDocument,
    baseline_bytes: Vec<u8>,
    observed_bytes: Option<Vec<u8>>,
}
impl Session {
    fn require_version(&self, expected: u64) -> Result<()> {
        if self.state.version != expected {
            return Err(DocumentError::new(
                "STALE_VERSION",
                "Refresh the document state before retrying",
            ));
        }
        Ok(())
    }
    fn bump(&mut self) -> Result<()> {
        self.state.version =
            self.state.version.checked_add(1).ok_or_else(|| {
                DocumentError::new("VERSION_EXHAUSTED", "Session version exhausted")
            })?;
        Ok(())
    }
    fn check(&mut self) -> Result<bool> {
        let change = match fs::read(&self.state.path) {
            Ok(bytes) if bytes == self.baseline_bytes => {
                self.observed_bytes = None;
                None
            }
            Ok(bytes) => {
                if self.observed_bytes.as_ref() == Some(&bytes) {
                    return Ok(false);
                }
                let result = ImageDocument::parse(&bytes).and_then(|doc| {
                    if doc.document_id != self.state.document.document_id {
                        Err(DocumentError::new(
                            "DOCUMENT_ID_CHANGED",
                            "External document identity differs",
                        ))
                    } else {
                        Ok(doc)
                    }
                });
                self.observed_bytes = Some(bytes);
                let (document, error) = match result {
                    Ok(doc) => (Some(doc), None),
                    Err(error) => (None, Some(error)),
                };
                Some(ExternalChange::Modified { document, error })
            }
            Err(e) => {
                self.observed_bytes = None;
                if e.kind() == std::io::ErrorKind::NotFound {
                    Some(ExternalChange::Missing)
                } else {
                    Some(ExternalChange::Unreadable {
                        error: DocumentError::new("READ_FAILED", e),
                    })
                }
            }
        };
        if change != self.state.external_change {
            self.bump()?;
            self.state.external_change = change;
            return Ok(true);
        }
        // Different bytes may parse to the same document. Invalidate stale actions anyway.
        if self.observed_bytes.is_some() {
            self.bump()?;
            return Ok(true);
        }
        Ok(false)
    }
    fn commit(&mut self, mut document: ImageDocument) -> Result<Snapshot> {
        if document.document_id != self.state.document.document_id
            || document.format != self.state.document.format
        {
            return Err(DocumentError::new(
                "DOCUMENT_ID_CHANGED",
                "An edit must preserve document identity and format",
            ));
        }
        if document.revision != self.state.document.revision {
            return Err(DocumentError::new(
                "INVALID_REVISION",
                "revision is managed by Rust",
            ));
        }
        document.validate()?;
        if document == self.state.document {
            return Ok(self.state.clone());
        }
        document.revision = self.state.document.revision.checked_add(1).ok_or_else(|| {
            DocumentError::new("VERSION_EXHAUSTED", "Document revision exhausted")
        })?;
        self.bump()?;
        self.state.dirty = document != self.baseline_document;
        self.state.document = document;
        Ok(self.state.clone())
    }
}

#[derive(Default)]
pub struct DocumentStore {
    sessions: BTreeMap<String, Session>,
    next_id: u64,
}
impl DocumentStore {
    fn session(&mut self, id: &str) -> Result<&mut Session> {
        self.sessions
            .get_mut(id)
            .ok_or_else(|| DocumentError::new("SESSION_NOT_FOUND", id))
    }
    pub fn open(&mut self, path: &Path) -> Result<Snapshot> {
        let path = fs::canonicalize(path).map_err(|e| DocumentError::new("OPEN_FAILED", e))?;
        if let Some(session) = self.sessions.values_mut().find(|s| s.state.path == path) {
            session.check()?;
            return Ok(session.state.clone());
        }
        let bytes = fs::read(&path).map_err(|e| DocumentError::new("READ_FAILED", e))?;
        let document = ImageDocument::parse(&bytes)?;
        self.next_id = self
            .next_id
            .checked_add(1)
            .ok_or_else(|| DocumentError::new("VERSION_EXHAUSTED", "Session IDs exhausted"))?;
        let session_id = format!("document-{}", self.next_id);
        let state = Snapshot {
            session_id: session_id.clone(),
            working_directory: lifecycle::working_directory(&path),
            path,
            document: document.clone(),
            version: 0,
            dirty: false,
            external_change: None,
        };
        self.sessions.insert(
            session_id,
            Session {
                state: state.clone(),
                baseline_document: document,
                baseline_bytes: bytes,
                observed_bytes: None,
            },
        );
        Ok(state)
    }
    pub fn get(&mut self, id: &str) -> Result<Snapshot> {
        Ok(self.session(id)?.state.clone())
    }
    pub fn list(&self) -> Vec<Snapshot> {
        self.sessions.values().map(|s| s.state.clone()).collect()
    }
    pub fn replace(
        &mut self,
        id: &str,
        expected: u64,
        document: ImageDocument,
    ) -> Result<Snapshot> {
        let session = self.session(id)?;
        session.require_version(expected)?;
        session.commit(document)
    }
    /// Patch node properties atomically. null removes a property; IDs/types/children are structural.
    pub fn patch_node(
        &mut self,
        id: &str,
        expected: u64,
        node_id: &str,
        patch: Map<String, Value>,
    ) -> Result<Snapshot> {
        let session = self.session(id)?;
        session.require_version(expected)?;
        if patch
            .keys()
            .any(|key| matches!(key.as_str(), "id" | "type" | "elements"))
        {
            return Err(DocumentError::new(
                "STRUCTURAL_PATCH",
                "Use replace_document for structural edits",
            ));
        }
        fn find<'a>(nodes: &'a mut [Node], id: &str) -> Option<&'a mut Node> {
            for node in nodes {
                if node.id == id {
                    return Some(node);
                }
                if let Some(found) = find(&mut node.elements, id) {
                    return Some(found);
                }
            }
            None
        }
        let mut doc = session.state.document.clone();
        let node = find(&mut doc.modules, node_id)
            .ok_or_else(|| DocumentError::new("NODE_NOT_FOUND", node_id))?;
        for (key, value) in patch {
            if value.is_null() {
                node.properties.remove(&key);
            } else {
                node.properties.insert(key, value);
            }
        }
        session.commit(doc)
    }
    pub fn check(&mut self, id: &str) -> Result<Snapshot> {
        let session = self.session(id)?;
        session.check()?;
        Ok(session.state.clone())
    }
    pub fn poll(&mut self) -> Vec<Snapshot> {
        self.sessions
            .values_mut()
            .filter_map(|s| match s.check() {
                Ok(true) => Some(s.state.clone()),
                _ => None,
            })
            .collect()
    }
    pub fn save(&mut self, id: &str, expected: u64) -> Result<Snapshot> {
        let session = self.session(id)?;
        session.require_version(expected)?;
        session.check()?;
        if session.state.external_change.is_some() {
            return Err(DocumentError::new(
                "EXTERNAL_CHANGE",
                "Resolve external changes before saving",
            ));
        }
        session.require_version(expected)?;
        if !session.state.dirty {
            return Ok(session.state.clone());
        }
        let bytes = session.state.document.encode()?;
        // The file check above is optimistic, not a cross-process compare-and-swap.
        atomic_write(&session.state.path, &bytes)?;
        session.bump()?;
        session.baseline_bytes = bytes;
        session.baseline_document = session.state.document.clone();
        session.observed_bytes = None;
        session.state.dirty = false;
        Ok(session.state.clone())
    }
    pub fn reload(&mut self, id: &str, expected: u64, discard_changes: bool) -> Result<Snapshot> {
        let session = self.session(id)?;
        session.require_version(expected)?;
        if session.state.dirty && !discard_changes {
            return Err(DocumentError::new(
                "UNSAVED_CHANGES",
                "Explicit discardChanges is required",
            ));
        }
        let bytes =
            fs::read(&session.state.path).map_err(|e| DocumentError::new("READ_FAILED", e))?;
        let document = ImageDocument::parse(&bytes)?;
        if document.document_id != session.state.document.document_id {
            return Err(DocumentError::new(
                "DOCUMENT_ID_CHANGED",
                "Close and reopen a different document",
            ));
        }
        session.bump()?;
        session.state.document = document.clone();
        session.baseline_document = document;
        session.baseline_bytes = bytes;
        session.observed_bytes = None;
        session.state.external_change = None;
        session.state.dirty = false;
        Ok(session.state.clone())
    }
    pub fn close(&mut self, id: &str, expected: u64, discard_changes: bool) -> Result<()> {
        let session = self.session(id)?;
        session.require_version(expected)?;
        if session.state.dirty && !discard_changes {
            return Err(DocumentError::new(
                "UNSAVED_CHANGES",
                "Explicit discardChanges is required",
            ));
        }
        self.sessions.remove(id);
        Ok(())
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
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
