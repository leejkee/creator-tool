//! Tauri transport and polling lifecycle. Domain state lives in document-core.
use creator_document_core::{
    DocumentError, DocumentStore, ImageDocument, Node, Snapshot, StyleNode,
};
use serde_json::{Map, Value};
use std::{path::Path, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};

type Result<T> = std::result::Result<T, DocumentError>;
#[derive(Default)]
pub struct Documents(Mutex<DocumentStore>);

pub(super) fn with_store<T>(
    state: &Documents,
    action: impl FnOnce(&mut DocumentStore) -> Result<T>,
) -> Result<T> {
    let mut store = state.0.lock().map_err(|_| DocumentError {
        code: "STATE_UNAVAILABLE".into(),
        message: "Document state lock is poisoned; restart the application".into(),
    })?;
    action(&mut store)
}
pub(super) fn publish(app: &AppHandle, snapshot: &Snapshot) {
    if let Err(error) = app.emit("document-state-changed", snapshot) {
        eprintln!("document-state-changed event delivery failed: {error}");
    }
}

#[tauri::command]
pub async fn open_document(
    app: AppHandle,
    state: State<'_, Documents>,
    path: String,
) -> Result<Snapshot> {
    with_store(&state, |store| {
        let snapshot = store.open(Path::new(&path))?;
        publish(&app, &snapshot);
        Ok(snapshot)
    })
}
#[tauri::command]
pub async fn get_document(state: State<'_, Documents>, session_id: String) -> Result<Snapshot> {
    with_store(&state, |store| store.get(&session_id))
}
#[tauri::command]
pub async fn list_documents(state: State<'_, Documents>) -> Result<Vec<Snapshot>> {
    with_store(&state, |store| Ok(store.list()))
}

// Publish current state even after errors: a failed save may discover external edits.
fn mutate(
    app: &AppHandle,
    state: &Documents,
    id: &str,
    action: impl FnOnce(&mut DocumentStore) -> Result<Snapshot>,
) -> Result<Snapshot> {
    with_store(state, |store| {
        let result = action(store);
        if let Ok(snapshot) = store.get(id) {
            publish(app, &snapshot);
        }
        result
    })
}
#[tauri::command]
pub async fn replace_document(
    app: AppHandle,
    state: State<'_, Documents>,
    session_id: String,
    expected_version: u64,
    document: Value,
) -> Result<Snapshot> {
    mutate(&app, &state, &session_id, |store| {
        store.replace(
            &session_id,
            expected_version,
            ImageDocument::from_value(document)?,
        )
    })
}
#[tauri::command]
pub async fn patch_document_node(
    app: AppHandle,
    state: State<'_, Documents>,
    session_id: String,
    expected_version: u64,
    node_id: String,
    patch: Map<String, Value>,
) -> Result<Snapshot> {
    mutate(&app, &state, &session_id, |store| {
        store.patch_node(&session_id, expected_version, &node_id, patch)
    })
}
#[tauri::command]
pub async fn save_document(
    app: AppHandle,
    state: State<'_, Documents>,
    session_id: String,
    expected_version: u64,
) -> Result<Snapshot> {
    mutate(&app, &state, &session_id, |store| {
        store.save(&session_id, expected_version)
    })
}
#[tauri::command]
pub async fn check_document_file(
    app: AppHandle,
    state: State<'_, Documents>,
    session_id: String,
) -> Result<Snapshot> {
    mutate(&app, &state, &session_id, |store| store.check(&session_id))
}
#[tauri::command]
pub async fn reload_document(
    app: AppHandle,
    state: State<'_, Documents>,
    session_id: String,
    expected_version: u64,
    discard_changes: bool,
) -> Result<Snapshot> {
    mutate(&app, &state, &session_id, |store| {
        store.reload(&session_id, expected_version, discard_changes)
    })
}
#[tauri::command]
pub async fn close_document(
    app: AppHandle,
    state: State<'_, Documents>,
    session_id: String,
    expected_version: u64,
    discard_changes: bool,
) -> Result<()> {
    with_store(&state, |store| {
        store.close(&session_id, expected_version, discard_changes)?;
        if let Err(error) = app.emit("document-closed", &session_id) {
            eprintln!("document-closed event delivery failed: {error}");
        }
        Ok(())
    })
}

pub fn start_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            // Timer does not block the async runtime. File reads run on its blocking pool.
            let handle = app.clone();
            if let Err(error) = tauri::async_runtime::spawn_blocking(move || {
                let state = handle.state::<Documents>();
                if let Err(error) = with_store(&state, |store| {
                    for snapshot in store.poll() {
                        publish(&handle, &snapshot);
                    }
                    Ok(())
                }) {
                    eprintln!("Document polling failed: {}", error.code);
                }
                std::thread::sleep(Duration::from_millis(500));
            })
            .await
            {
                eprintln!("Document polling task failed: {error}");
                break;
            }
        }
    });
}

#[tauri::command]
pub async fn create_document(
    app: AppHandle,
    state: State<'_, Documents>,
    base_directory: Option<String>,
    source_session_id: Option<String>,
    module_name: String,
    template_path: Option<String>,
) -> Result<Snapshot> {
    with_store(&state, |store| {
        let snapshot = store.create(
            base_directory.as_deref().map(Path::new),
            source_session_id.as_deref(),
            &module_name,
            template_path.as_deref().map(Path::new),
        )?;
        publish(&app, &snapshot);
        Ok(snapshot)
    })
}

#[tauri::command]
pub async fn save_document_as(
    app: AppHandle,
    state: State<'_, Documents>,
    session_id: String,
    expected_version: u64,
    target_directory: String,
    file_name: String,
) -> Result<Snapshot> {
    mutate(&app, &state, &session_id, |store| {
        store.save_as(
            &session_id,
            expected_version,
            Path::new(&target_directory),
            &file_name,
        )
    })
}

#[tauri::command]
pub async fn set_module_layout(
    app: AppHandle,
    state: State<'_, Documents>,
    session_id: String,
    expected_version: u64,
    parent_id: String,
    layout: (u32, u32),
) -> Result<Snapshot> {
    mutate(&app, &state, &session_id, |store| {
        store.set_module_layout(&session_id, expected_version, &parent_id, layout)
    })
}

#[tauri::command]
pub async fn set_module_position(
    app: AppHandle,
    state: State<'_, Documents>,
    session_id: String,
    expected_version: u64,
    parent_id: String,
    module_id: String,
    position: (u32, u32),
) -> Result<Snapshot> {
    mutate(&app, &state, &session_id, |store| {
        store.set_module_position(
            &session_id,
            expected_version,
            &parent_id,
            &module_id,
            position,
        )
    })
}

/// Stateless operations also support modules that are not attached to an open document.
#[tauri::command]
pub fn apply_module_style(image: Node, style: StyleNode) -> Result<Node> {
    creator_document_core::apply_style(&image, &style)
}

#[tauri::command]
pub async fn apply_document_style(
    app: AppHandle,
    state: State<'_, Documents>,
    session_id: String,
    expected_version: u64,
    module_id: String,
    style: StyleNode,
) -> Result<Snapshot> {
    mutate(&app, &state, &session_id, |store| {
        store.apply_style(&session_id, expected_version, &module_id, &style)
    })
}
