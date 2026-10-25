//! File creation and Save As. These operations never overwrite an existing destination.
use super::*;
use uuid::Uuid;

fn validate_name(name: &str) -> Result<()> {
    let reserved = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.trim().is_empty()
        || name.trim() != name
        || name.ends_with('.')
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || matches!(reserved.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (1..=9).any(|n| reserved == format!("COM{n}") || reserved == format!("LPT{n}"))
    {
        return Err(DocumentError::new(
            "INVALID_NAME",
            "Use a nonempty portable file name without path separators",
        ));
    }
    Ok(())
}

fn directory(path: &Path) -> Result<PathBuf> {
    let path = fs::canonicalize(path).map_err(|e| DocumentError::new("INVALID_DIRECTORY", e))?;
    if !path.is_dir() {
        return Err(DocumentError::new(
            "INVALID_DIRECTORY",
            "Select an existing directory",
        ));
    }
    Ok(path)
}

fn json_filename(name: &str) -> Result<String> {
    validate_name(name)?;
    let name = if name.to_ascii_lowercase().ends_with(".json") {
        name.to_owned()
    } else {
        format!("{name}.json")
    };
    if name.eq_ignore_ascii_case(".json") {
        return Err(DocumentError::new(
            "INVALID_NAME",
            "A JSON file must have a name",
        ));
    }
    Ok(name)
}

// Preserve references when the JSON moves without requiring every resource to exist now.
fn absolute_reference(value: &mut Value, source_directory: &Path) {
    if let Some(reference) = value.as_str() {
        let is_windows_absolute =
            reference.as_bytes().get(1) == Some(&b':') || reference.starts_with("\\\\");
        if !reference.is_empty() && !Path::new(reference).is_absolute() && !is_windows_absolute {
            *value = Value::String(
                source_directory
                    .join(reference)
                    .to_string_lossy()
                    .into_owned(),
            );
        }
    }
}
fn rebase_style(style: &mut Value, source: &Path) {
    if let Some(style) = style.as_object_mut() {
        if let Some(font) = style.get_mut("font") {
            absolute_reference(font, source);
        }
        if let Some(path) = style
            .get_mut("background")
            .and_then(Value::as_object_mut)
            .and_then(|background| background.get_mut("assetPath"))
        {
            absolute_reference(path, source);
        }
    }
}
fn rebase_document(doc: &mut ImageDocument, source: &Path) {
    let assets = doc
        .properties
        .entry("assetsDir")
        .or_insert(Value::String("assets/".into()));
    absolute_reference(assets, source);
    if let Some(fonts) = doc
        .properties
        .get_mut("fonts")
        .and_then(Value::as_object_mut)
    {
        for font in fonts.values_mut() {
            absolute_reference(font, source);
        }
    }
    if let Some(path) = doc
        .composition
        .get_mut("background")
        .and_then(Value::as_object_mut)
        .and_then(|background| background.get_mut("assetPath"))
    {
        absolute_reference(path, source);
    }
    fn visit(nodes: &mut [Node], source: &Path) {
        for node in nodes {
            if let Some(path) = node.properties.get_mut("assetPath") {
                absolute_reference(path, source);
            }
            if let Some(style) = node.properties.get_mut("style") {
                rebase_style(style, source);
            }
            visit(&mut node.elements, source);
        }
    }
    visit(&mut doc.modules, source);
}

fn write_new(path: &Path, document: &ImageDocument) -> Result<Vec<u8>> {
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

impl DocumentStore {
    /// Save the in-memory document as a new file and move this session to that file.
    /// The original file, including any external edits, is left untouched.
    pub fn save_as(
        &mut self,
        id: &str,
        expected: u64,
        target_directory: &Path,
        file_name: &str,
    ) -> Result<Snapshot> {
        let parent = directory(target_directory)?;
        let target = parent.join(json_filename(file_name)?);
        let session = self.session(id)?;
        session.require_version(expected)?;
        let next_version =
            session.state.version.checked_add(1).ok_or_else(|| {
                DocumentError::new("VERSION_EXHAUSTED", "Session version exhausted")
            })?;
        let mut document = session.state.document.clone();
        rebase_document(
            &mut document,
            session
                .state
                .path
                .parent()
                .expect("Canonical file has parent"),
        );
        document.document_id = Uuid::new_v4().to_string();
        document.revision = 0;
        let bytes = write_new(&target, &document)?;
        session.state.working_directory = working_directory(&target);
        session.state.path = target;
        session.state.document = document.clone();
        session.state.version = next_version;
        session.state.dirty = false;
        session.state.external_change = None;
        session.baseline_document = document;
        session.baseline_bytes = bytes;
        session.observed_bytes = None;
        Ok(session.state.clone())
    }
}

// New modules follow base/name/name.json. Older standalone files use their parent.
pub(super) fn working_directory(path: &Path) -> PathBuf {
    let parent = path.parent().expect("Canonical document path has a parent");
    if path.file_stem() == parent.file_name() {
        parent.parent().unwrap_or(parent).to_path_buf()
    } else {
        parent.to_path_buf()
    }
}

impl DocumentStore {
    /// Create base/name/name.json, using a selected base or an explicitly selected session.
    pub fn create(
        &mut self,
        base_directory: Option<&Path>,
        source_session_id: Option<&str>,
        module_name: &str,
        template_path: Option<&Path>,
    ) -> Result<Snapshot> {
        validate_name(module_name)?;
        let base = match base_directory {
            Some(path) => directory(path)?,
            None => {
                let id = source_session_id.ok_or_else(|| {
                    DocumentError::new(
                        "DIRECTORY_REQUIRED",
                        "Select a base directory before creating a module",
                    )
                })?;
                directory(&self.session(id)?.state.working_directory)?
            }
        };
        let next_id = self
            .next_id
            .checked_add(1)
            .ok_or_else(|| DocumentError::new("VERSION_EXHAUSTED", "Session IDs exhausted"))?;
        let mut document = if let Some(template) = template_path {
            let path = fs::canonicalize(template)
                .map_err(|e| DocumentError::new("TEMPLATE_READ_FAILED", e))?;
            let bytes =
                fs::read(&path).map_err(|e| DocumentError::new("TEMPLATE_READ_FAILED", e))?;
            let mut doc = ImageDocument::parse(&bytes)?;
            rebase_document(
                &mut doc,
                path.parent().expect("Canonical template has a parent"),
            );
            doc
        } else {
            ImageDocument {
                format: "v0.1.0".into(),
                document_id: String::new(),
                revision: 0,
                composition:
                    serde_json::json!({"width":1200,"height":"auto","padding":32,"gap":24})
                        .as_object()
                        .unwrap()
                        .clone(),
                modules: Vec::new(),
                properties: Map::new(),
            }
        };
        document.document_id = Uuid::new_v4().to_string();
        document.revision = 0;
        document
            .properties
            .insert("title".into(), Value::String(module_name.into()));
        document
            .properties
            .entry("assetsDir")
            .or_insert(Value::String("assets/".into()));
        document.validate()?;
        let module_directory = base.join(module_name);
        fs::create_dir(&module_directory).map_err(|e| {
            DocumentError::new(
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    "MODULE_EXISTS"
                } else {
                    "CREATE_FAILED"
                },
                e,
            )
        })?;
        let path = module_directory.join(format!("{module_name}.json"));
        let bytes = match write_new(&path, &document) {
            Ok(bytes) => bytes,
            Err(error) => {
                // Never recursively remove a directory: another process might have added files.
                let _ = fs::remove_dir(&module_directory);
                return Err(error);
            }
        };
        self.next_id = next_id;
        let session_id = format!("document-{next_id}");
        let state = Snapshot {
            session_id: session_id.clone(),
            path,
            working_directory: base,
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
}
