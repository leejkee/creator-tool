mod common;
use common::*;
use creator_document_core::{DocumentStore, ExternalChange, ImageDocument, Snapshot};
use serde_json::{Value, json};
use std::{fs, path::PathBuf};
use tempfile::TempDir;

struct Workspace {
    _directory: TempDir,
    path: PathBuf,
    store: DocumentStore,
    initial: Snapshot,
}
impl Workspace {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("图片.json");
        fs::write(&path, document().encode().unwrap()).unwrap();
        let mut store = DocumentStore::default();
        let initial = store.open(&path).unwrap();
        Self {
            _directory: directory,
            path,
            store,
            initial,
        }
    }
    fn edit(&mut self, version: u64, patch: Value) -> Snapshot {
        self.store
            .patch_node(
                &self.initial.session_id,
                version,
                "body",
                patch.as_object().unwrap().clone(),
            )
            .unwrap()
    }
    fn state(&mut self) -> Snapshot {
        self.store.get(&self.initial.session_id).unwrap()
    }
    fn write_external(&self, doc: &ImageDocument) {
        fs::write(&self.path, doc.encode().unwrap()).unwrap();
    }
}

#[test]
fn opening_reuses_canonical_paths_and_keeps_distinct_files_independent() {
    let mut w = Workspace::new();
    let alias = w.path.parent().unwrap().join(".").join("图片.json");
    assert_same_snapshot(&w.store.open(&alias).unwrap(), &w.initial);
    let second_path = w.path.with_file_name("second.json");
    fs::copy(&w.path, &second_path).unwrap();
    let second = w.store.open(&second_path).unwrap();
    assert_ne!(w.initial.session_id, second.session_id);
    w.edit(0, json!({"text":"仅修改第一份"}));
    assert_same_snapshot(&w.store.get(&second.session_id).unwrap(), &second);
    assert_eq!(w.store.list().len(), 2);
}

#[test]
fn failed_open_does_not_create_a_session_or_change_the_file() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("bad.json");
    let mut store = DocumentStore::default();
    assert_error(store.open(&path), "OPEN_FAILED");
    fs::write(&path, b"{broken").unwrap();
    assert_error(store.open(&path), "INVALID_JSON");
    assert!(store.list().is_empty());
    assert_eq!(fs::read(path).unwrap(), b"{broken");
}

#[test]
fn edits_are_in_memory_until_save_and_preserve_other_content() {
    let mut w = Workspace::new();
    let original_bytes = fs::read(&w.path).unwrap();
    let edited = w.edit(0, json!({"text":"Rust 中文修改"}));
    assert!(edited.dirty);
    assert_eq!((edited.version, edited.document.revision), (1, 1));
    let mut expected = w.initial.document.clone();
    expected.revision = 1;
    expected.modules[0].children[1]
        .module
        .properties
        .insert("text".into(), json!("Rust 中文修改"));
    assert_eq!(edited.document, expected);
    assert_eq!(fs::read(&w.path).unwrap(), original_bytes);
    let saved = w.store.save(&edited.session_id, edited.version).unwrap();
    assert!(!saved.dirty);
    assert_eq!((saved.version, saved.document.revision), (2, 1));
    assert_eq!(
        ImageDocument::parse(&fs::read(&w.path).unwrap()).unwrap(),
        expected
    );
    assert!(w.store.poll().is_empty());
    assert_eq!(fs::read_dir(w.path.parent().unwrap()).unwrap().count(), 1);
    let reopened = DocumentStore::default().open(&w.path).unwrap();
    assert_eq!(reopened.document, expected);
    assert!(!reopened.dirty);
}

#[test]
fn no_op_edit_and_clean_save_do_not_advance_versions_or_reformat_the_file() {
    let mut w = Workspace::new();
    let bytes = fs::read(&w.path).unwrap();
    let state = w
        .store
        .replace(&w.initial.session_id, 0, w.initial.document.clone())
        .unwrap();
    assert_same_snapshot(&state, &w.initial);
    let state = w.edit(0, json!({"text":"正文"}));
    assert_same_snapshot(&state, &w.initial);
    let saved = w.store.save(&state.session_id, 0).unwrap();
    assert_same_snapshot(&saved, &w.initial);
    assert_eq!(fs::read(&w.path).unwrap(), bytes);
}

#[test]
fn patches_replace_nested_properties_and_null_removes_optional_properties() {
    let mut w = Workspace::new();
    let state = w.edit(0, json!({"style":{"fontSize":20},"futureNodeField":null}));
    let properties = &state.document.modules[0].children[1].module.properties;
    assert_eq!(properties["style"], json!({"fontSize":20}));
    assert!(!properties.contains_key("futureNodeField"));
    assert_eq!(properties["text"], "正文");
}

#[test]
fn rejected_patches_are_atomic() {
    let mut w = Workspace::new();
    for key in ["id", "type", "elements", "children", "layout", "position"] {
        assert_error(
            w.store.patch_node(
                &w.initial.session_id,
                0,
                "body",
                json!({key:"changed","text":"不要提交"})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
            "STRUCTURAL_PATCH",
        );
        assert_same_snapshot(&w.state(), &w.initial);
    }
    assert_error(
        w.store.patch_node(
            &w.initial.session_id,
            0,
            "missing",
            json!({"text":"x"}).as_object().unwrap().clone(),
        ),
        "NODE_NOT_FOUND",
    );
    assert_error(
        w.store.patch_node(
            &w.initial.session_id,
            0,
            "body",
            json!({"text":null}).as_object().unwrap().clone(),
        ),
        "INVALID_NODE",
    );
    assert_same_snapshot(&w.state(), &w.initial);
}

#[test]
fn whole_document_edits_allow_structure_changes_but_preserve_identity_and_revision_ownership() {
    let mut w = Workspace::new();
    let mut changed = w.initial.document.clone();
    changed.modules[0].children.pop();
    changed.composition.insert("width".into(), json!(800));
    let updated = w.store.replace(&w.initial.session_id, 0, changed).unwrap();
    assert_eq!(updated.document.modules[0].children.len(), 1);
    assert_eq!(updated.document.composition["width"], 800);
    for field in ["identity", "format", "revision", "duplicate"] {
        let mut invalid = updated.document.clone();
        let code = match field {
            "identity" => {
                invalid.document_id = "another".into();
                "DOCUMENT_ID_CHANGED"
            }
            "format" => {
                invalid.format = "v2".into();
                "DOCUMENT_ID_CHANGED"
            }
            "revision" => {
                invalid.revision += 1;
                "INVALID_REVISION"
            }
            _ => {
                invalid.modules.push(invalid.modules[0].clone());
                "INVALID_NODE_ID"
            }
        };
        assert_error(
            w.store
                .replace(&updated.session_id, updated.version, invalid),
            code,
        );
        assert_same_snapshot(&w.state(), &updated);
    }
}

#[test]
fn stale_versions_are_rejected_for_all_mutating_session_actions() {
    let mut w = Workspace::new();
    let state = w.edit(0, json!({"text":"当前内容"}));
    let id = &state.session_id;
    assert_error(
        w.store.replace(id, 0, state.document.clone()),
        "STALE_VERSION",
    );
    assert_error(
        w.store.patch_node(id, 0, "body", Default::default()),
        "STALE_VERSION",
    );
    assert_error(w.store.save(id, 0), "STALE_VERSION");
    assert_error(w.store.reload(id, 0, true), "STALE_VERSION");
    assert_error(w.store.close(id, 0, true), "STALE_VERSION");
    assert_same_snapshot(&w.state(), &state);
}

#[test]
fn revision_overflow_is_reported_without_mutating_document_or_disk() {
    let mut w = Workspace::new();
    let mut doc = document();
    doc.revision = u64::MAX;
    w.write_external(&doc);
    let state = w.store.reload(&w.initial.session_id, 0, false).unwrap();
    assert_error(
        w.store.patch_node(
            &state.session_id,
            state.version,
            "body",
            json!({"text":"overflow"}).as_object().unwrap().clone(),
        ),
        "VERSION_EXHAUSTED",
    );
    assert_same_snapshot(&w.state(), &state);
    assert_eq!(
        ImageDocument::parse(&fs::read(&w.path).unwrap()).unwrap(),
        doc
    );
}

#[test]
fn external_edits_are_candidates_and_do_not_replace_dirty_local_content() {
    let mut w = Workspace::new();
    let local = w.edit(0, json!({"text":"本地内容"}));
    let mut external = w.initial.document.clone();
    external
        .properties
        .insert("title".into(), json!("外部标题"));
    w.write_external(&external);
    let events = w.store.poll();
    assert_eq!(events.len(), 1);
    let candidate = &events[0];
    assert_eq!(candidate.document, local.document);
    assert!(candidate.dirty);
    assert_eq!(candidate.version, local.version + 1);
    assert_eq!(
        candidate.external_change,
        Some(ExternalChange::Modified {
            document: Some(external.clone()),
            error: None
        })
    );
    assert!(w.store.poll().is_empty());
    assert_error(
        w.store.save(&local.session_id, candidate.version),
        "EXTERNAL_CHANGE",
    );
    assert_eq!(
        ImageDocument::parse(&fs::read(&w.path).unwrap()).unwrap(),
        external
    );
    assert_same_snapshot(&w.state(), candidate);
}

#[test]
fn save_detects_unpolled_external_changes_before_writing() {
    let mut w = Workspace::new();
    let local = w.edit(0, json!({"text":"本地内容"}));
    fs::write(&w.path, b"{broken").unwrap();
    assert_error(
        w.store.save(&local.session_id, local.version),
        "EXTERNAL_CHANGE",
    );
    assert_eq!(fs::read(&w.path).unwrap(), b"{broken");
    let state = w.state();
    assert_eq!(state.document, local.document);
    assert!(state.external_change.is_some());
}

#[test]
fn formatting_only_changes_are_detected_and_baseline_restoration_clears_them() {
    let mut w = Workspace::new();
    let baseline = fs::read(&w.path).unwrap();
    fs::write(&w.path, serde_json::to_vec(&w.initial.document).unwrap()).unwrap();
    let candidate = w.store.check(&w.initial.session_id).unwrap();
    assert!(candidate.external_change.is_some());
    assert!(w.store.poll().is_empty());
    let mut reformatted = fs::read(&w.path).unwrap();
    reformatted.push(b' ');
    fs::write(&w.path, reformatted).unwrap();
    let events = w.store.poll();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].version, candidate.version + 1);
    fs::write(&w.path, baseline).unwrap();
    let restored = w.store.check(&candidate.session_id).unwrap();
    assert!(restored.external_change.is_none());
    assert!(!restored.dirty);
    assert_eq!(restored.version, candidate.version + 2);
    assert!(w.store.poll().is_empty());
}

#[test]
fn restoring_baseline_during_save_invalidates_the_old_expected_version() {
    let mut w = Workspace::new();
    let baseline = fs::read(&w.path).unwrap();
    fs::write(&w.path, b"{broken").unwrap();
    let candidate = w.store.check(&w.initial.session_id).unwrap();
    let local = w.edit(candidate.version, json!({"text":"保留本地"}));
    fs::write(&w.path, &baseline).unwrap();
    assert_error(
        w.store.save(&local.session_id, local.version),
        "STALE_VERSION",
    );
    assert_eq!(fs::read(&w.path).unwrap(), baseline);
    let refreshed = w.state();
    assert!(refreshed.dirty);
    assert!(refreshed.external_change.is_none());
    w.store.save(&local.session_id, refreshed.version).unwrap();
}

#[test]
fn invalid_external_json_and_identity_changes_preserve_local_state_on_reload_failure() {
    let mut w = Workspace::new();
    fs::write(&w.path, b"{broken").unwrap();
    let state = w.store.check(&w.initial.session_id).unwrap();
    match &state.external_change {
        Some(ExternalChange::Modified {
            document: None,
            error: Some(error),
        }) => assert_eq!(error.code, "INVALID_JSON"),
        other => panic!("Expected invalid external candidate, got {other:?}"),
    }
    assert_error(
        w.store.reload(&state.session_id, state.version, true),
        "INVALID_JSON",
    );
    assert_same_snapshot(&w.state(), &state);
    let mut external = document();
    external.document_id = "different-identity".into();
    w.write_external(&external);
    let state = w.store.check(&state.session_id).unwrap();
    match &state.external_change {
        Some(ExternalChange::Modified {
            document: None,
            error: Some(error),
        }) => assert_eq!(error.code, "DOCUMENT_ID_CHANGED"),
        other => panic!("Expected identity error, got {other:?}"),
    }
    assert_error(
        w.store.reload(&state.session_id, state.version, true),
        "DOCUMENT_ID_CHANGED",
    );
    assert_same_snapshot(&w.state(), &state);
    assert_eq!(state.document, w.initial.document);
}

#[test]
fn missing_and_unreadable_files_are_distinct_and_recovery_is_detected() {
    let mut w = Workspace::new();
    let baseline = fs::read(&w.path).unwrap();
    fs::remove_file(&w.path).unwrap();
    let missing = w.store.check(&w.initial.session_id).unwrap();
    assert_eq!(missing.external_change, Some(ExternalChange::Missing));
    assert!(w.store.poll().is_empty());
    assert_error(
        w.store.reload(&missing.session_id, missing.version, false),
        "READ_FAILED",
    );
    assert_error(
        w.store.save(&missing.session_id, missing.version),
        "EXTERNAL_CHANGE",
    );
    assert!(!w.path.exists());
    // Reading a directory fails on supported desktop platforms, even when run as root.
    fs::create_dir(&w.path).unwrap();
    let unreadable = w.store.check(&missing.session_id).unwrap();
    assert!(matches!(
        unreadable.external_change,
        Some(ExternalChange::Unreadable { .. })
    ));
    assert!(w.store.poll().is_empty());
    fs::remove_dir(&w.path).unwrap();
    fs::write(&w.path, baseline).unwrap();
    let restored = w.store.check(&missing.session_id).unwrap();
    assert!(restored.external_change.is_none());
    assert_eq!(restored.document, w.initial.document);
}

#[test]
fn dirty_reload_requires_explicit_discard_and_preserves_disk_revision() {
    let mut w = Workspace::new();
    let local = w.edit(0, json!({"text":"未保存"}));
    let mut external = document();
    external.revision = 12;
    external
        .properties
        .insert("title".into(), json!("磁盘文档"));
    w.write_external(&external);
    assert_error(
        w.store.reload(&local.session_id, local.version, false),
        "UNSAVED_CHANGES",
    );
    assert_same_snapshot(&w.state(), &local);
    let reloaded = w
        .store
        .reload(&local.session_id, local.version, true)
        .unwrap();
    assert_eq!(reloaded.document, external);
    assert_eq!(reloaded.version, local.version + 1);
    assert!(!reloaded.dirty);
    assert!(reloaded.external_change.is_none());
    assert!(w.store.poll().is_empty());
}

#[test]
fn close_guards_unsaved_changes_and_reopening_gets_a_new_session() {
    let mut w = Workspace::new();
    let original_bytes = fs::read(&w.path).unwrap();
    let local = w.edit(0, json!({"text":"放弃的修改"}));
    assert_error(
        w.store.close(&local.session_id, local.version, false),
        "UNSAVED_CHANGES",
    );
    assert_same_snapshot(&w.state(), &local);
    w.store
        .close(&local.session_id, local.version, true)
        .unwrap();
    assert!(w.store.list().is_empty());
    assert_error(w.store.get(&local.session_id), "SESSION_NOT_FOUND");
    let reopened = w.store.open(&w.path).unwrap();
    assert_ne!(reopened.session_id, local.session_id);
    assert_eq!(reopened.document, w.initial.document);
    assert_eq!(fs::read(&w.path).unwrap(), original_bytes);
    w.store
        .close(&reopened.session_id, reopened.version, false)
        .unwrap();
}

#[test]
fn commands_reject_unknown_sessions() {
    let mut store = DocumentStore::default();
    assert_error(store.get("missing"), "SESSION_NOT_FOUND");
    assert_error(store.check("missing"), "SESSION_NOT_FOUND");
    assert_error(store.replace("missing", 0, document()), "SESSION_NOT_FOUND");
    assert_error(
        store.patch_node("missing", 0, "body", Default::default()),
        "SESSION_NOT_FOUND",
    );
    assert_error(store.save("missing", 0), "SESSION_NOT_FOUND");
    assert_error(store.reload("missing", 0, true), "SESSION_NOT_FOUND");
    assert_error(store.close("missing", 0, true), "SESSION_NOT_FOUND");
}
