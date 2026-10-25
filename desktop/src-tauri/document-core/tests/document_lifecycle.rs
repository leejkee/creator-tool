mod common;
use common::*;
use creator_document_core::{DocumentStore, ImageDocument};
use serde_json::json;
use std::{fs, path::Path};

#[test]
fn first_module_requires_a_directory_and_a_portable_name() {
    let base = tempfile::tempdir().unwrap();
    let mut store = DocumentStore::default();
    assert_error(
        store.create(None, None, "新模块", None),
        "DIRECTORY_REQUIRED",
    );
    for name in [
        "",
        " ",
        ".",
        "..",
        "../escape",
        "a/b",
        "a\\b",
        "trailing.",
        " padded",
        "CON",
        "aux.txt",
        "LPT1",
        "a:b",
        "line\nbreak",
    ] {
        assert_error(
            store.create(Some(base.path()), None, name, None),
            "INVALID_NAME",
        );
    }
    assert!(store.list().is_empty());
    assert_eq!(fs::read_dir(base.path()).unwrap().count(), 0);
    assert_error(
        store.create(Some(&base.path().join("missing")), None, "新模块", None),
        "INVALID_DIRECTORY",
    );
}

#[test]
fn creating_a_module_writes_named_folder_and_json_and_reuses_its_working_directory() {
    let base = tempfile::tempdir().unwrap();
    let base_path = base.path().canonicalize().unwrap();
    let mut store = DocumentStore::default();
    let a = store
        .create(Some(base.path()), None, "模块A", None)
        .unwrap();
    assert_eq!(a.path, base_path.join("模块A/模块A.json"));
    assert_eq!(a.working_directory, base_path);
    assert_eq!(a.document.properties["title"], "模块A");
    assert_eq!(a.document.revision, 0);
    assert!(!a.document.document_id.is_empty());
    assert!(!a.dirty);
    assert_eq!(
        ImageDocument::parse(&fs::read(&a.path).unwrap()).unwrap(),
        a.document
    );
    let b = store
        .create(None, Some(&a.session_id), "模块B", None)
        .unwrap();
    assert_eq!(b.path, base_path.join("模块B/模块B.json"));
    assert_ne!(a.document.document_id, b.document.document_id);
    assert!(store.poll().is_empty());
    assert_eq!(store.list().len(), 2);
}

#[test]
fn reopening_a_named_module_retains_sibling_creation_behavior() {
    let base = tempfile::tempdir().unwrap();
    let mut store = DocumentStore::default();
    let a = store.create(Some(base.path()), None, "A", None).unwrap();
    let mut reopened_store = DocumentStore::default();
    let reopened = reopened_store.open(&a.path).unwrap();
    let b = reopened_store
        .create(None, Some(&reopened.session_id), "B", None)
        .unwrap();
    assert_eq!(b.path, base.path().canonicalize().unwrap().join("B/B.json"));
}

#[test]
fn standalone_json_uses_its_parent_as_the_working_directory() {
    let base = tempfile::tempdir().unwrap();
    let file = base.path().join("existing.json");
    fs::write(&file, document().encode().unwrap()).unwrap();
    let mut store = DocumentStore::default();
    let existing = store.open(&file).unwrap();
    let child = store
        .create(None, Some(&existing.session_id), "New", None)
        .unwrap();
    assert_eq!(
        child.path,
        base.path().canonicalize().unwrap().join("New/New.json")
    );
}

#[test]
fn existing_module_directory_is_never_reused_or_overwritten() {
    let base = tempfile::tempdir().unwrap();
    let mut store = DocumentStore::default();
    let a = store.create(Some(base.path()), None, "A", None).unwrap();
    let bytes = fs::read(&a.path).unwrap();
    assert_error(
        store.create(Some(base.path()), None, "A", None),
        "MODULE_EXISTS",
    );
    assert_eq!(fs::read(&a.path).unwrap(), bytes);
    assert_eq!(store.list().len(), 1);
    fs::create_dir(base.path().join("Empty")).unwrap();
    assert_error(
        store.create(Some(base.path()), None, "Empty", None),
        "MODULE_EXISTS",
    );
}

#[test]
fn template_creation_preserves_content_and_rebases_resources_without_editing_template() {
    let base = tempfile::tempdir().unwrap();
    let templates = tempfile::tempdir().unwrap();
    let source = templates.path().canonicalize().unwrap();
    let path = source.join("template.json");
    let mut template = document();
    template.revision = 17;
    template.properties.insert("assetsDir".into(), json!("art"));
    template
        .properties
        .insert("fonts".into(), json!({"regular":"fonts/main.ttf"}));
    template.modules[0].elements[1].properties.insert(
        "style".into(),
        json!({"font":"fonts/override.ttf","background":{"type":"image","assetPath":"bg.png"}}),
    );
    let bytes = template.encode().unwrap();
    fs::write(&path, &bytes).unwrap();
    let mut store = DocumentStore::default();
    let created = store
        .create(Some(base.path()), None, "FromTemplate", Some(&path))
        .unwrap();
    assert_ne!(created.document.document_id, template.document_id);
    assert_eq!(created.document.revision, 0);
    assert_eq!(created.document.properties["title"], "FromTemplate");
    assert_eq!(
        created.document.properties["sourceNotes"],
        template.properties["sourceNotes"]
    );
    assert_eq!(
        created.document.properties["futureDocumentField"],
        template.properties["futureDocumentField"]
    );
    assert_eq!(created.document.modules[0].elements[1].id, "body");
    assert_eq!(
        created.document.modules[0].elements[1].properties["text"],
        "正文"
    );
    assert_eq!(
        created.document.properties["assetsDir"],
        json!(source.join("art"))
    );
    assert_eq!(
        created.document.properties["fonts"]["regular"],
        json!(source.join("fonts/main.ttf"))
    );
    let style = &created.document.modules[0].elements[1].properties["style"];
    assert_eq!(style["font"], json!(source.join("fonts/override.ttf")));
    assert_eq!(
        style["background"]["assetPath"],
        json!(source.join("bg.png"))
    );
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn invalid_or_missing_template_leaves_no_module_directory_or_session() {
    let base = tempfile::tempdir().unwrap();
    let templates = tempfile::tempdir().unwrap();
    let path = templates.path().join("bad.json");
    let mut store = DocumentStore::default();
    assert_error(
        store.create(Some(base.path()), None, "New", Some(&path)),
        "TEMPLATE_READ_FAILED",
    );
    fs::write(&path, b"{broken").unwrap();
    assert_error(
        store.create(Some(base.path()), None, "New", Some(&path)),
        "INVALID_JSON",
    );
    assert!(!base.path().join("New").exists());
    assert!(store.list().is_empty());
}

#[test]
fn explicit_base_directory_overrides_the_current_modules_working_directory() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let mut store = DocumentStore::default();
    let a = store.create(Some(first.path()), None, "A", None).unwrap();
    let b = store
        .create(Some(second.path()), Some(&a.session_id), "B", None)
        .unwrap();
    assert_eq!(
        b.path,
        second.path().canonicalize().unwrap().join("B/B.json")
    );
    assert_error(
        store.create(None, Some("missing"), "C", None),
        "SESSION_NOT_FOUND",
    );
}

#[test]
fn save_as_requires_an_explicit_directory_and_filename_and_never_overwrites() {
    let base = tempfile::tempdir().unwrap();
    let mut store = DocumentStore::default();
    let a = store.create(Some(base.path()), None, "A", None).unwrap();
    for name in ["", "../escape.json", "CON.json", ".json"] {
        assert_error(
            store.save_as(&a.session_id, 0, base.path(), name),
            "INVALID_NAME",
        );
    }
    assert_error(
        store.save_as(&a.session_id, 0, &base.path().join("missing"), "copy"),
        "INVALID_DIRECTORY",
    );
    assert_error(
        store.save_as(&a.session_id, 0, a.path.parent().unwrap(), "A.json"),
        "FILE_EXISTS",
    );
    assert_same_snapshot(&store.get(&a.session_id).unwrap(), &a);
}

#[test]
fn save_as_can_rescue_local_edits_from_external_conflict_and_switches_session_only_after_success() {
    let base = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let path = base.path().join("original.json");
    fs::write(&path, document().encode().unwrap()).unwrap();
    let mut store = DocumentStore::default();
    let a = store.open(&path).unwrap();
    let local = store
        .patch_node(
            &a.session_id,
            0,
            "body",
            json!({"text":"本地修改"}).as_object().unwrap().clone(),
        )
        .unwrap();
    fs::write(&path, b"{external").unwrap();
    let conflict = store.check(&a.session_id).unwrap();
    assert!(conflict.external_change.is_some());
    assert_error(
        store.save_as(&a.session_id, local.version, target.path(), "copy"),
        "STALE_VERSION",
    );
    assert!(!target.path().join("copy.json").exists());
    let saved = store
        .save_as(&a.session_id, conflict.version, target.path(), "copy")
        .unwrap();
    assert_eq!(saved.session_id, a.session_id);
    assert_eq!(
        saved.path,
        target.path().canonicalize().unwrap().join("copy.json")
    );
    assert_eq!(
        saved.working_directory,
        target.path().canonicalize().unwrap()
    );
    assert_eq!(saved.version, conflict.version + 1);
    assert_ne!(saved.document.document_id, a.document.document_id);
    assert_eq!(saved.document.revision, 0);
    assert!(!saved.dirty);
    assert!(saved.external_change.is_none());
    assert_eq!(
        saved.document.modules[0].elements[1].properties["text"],
        "本地修改"
    );
    assert_eq!(
        saved.document.properties["sourceNotes"],
        a.document.properties["sourceNotes"]
    );
    assert_eq!(
        saved.document.properties["assetsDir"],
        json!(base.path().canonicalize().unwrap().join("assets/"))
    );
    assert_eq!(fs::read(&path).unwrap(), b"{external");
    assert_eq!(
        ImageDocument::parse(&fs::read(&saved.path).unwrap()).unwrap(),
        saved.document
    );
    assert!(store.poll().is_empty());
}

#[test]
fn save_as_collision_preserves_both_sessions_and_files() {
    let base = tempfile::tempdir().unwrap();
    let mut store = DocumentStore::default();
    let a = store.create(Some(base.path()), None, "A", None).unwrap();
    let b = store.create(Some(base.path()), None, "B", None).unwrap();
    let bytes = fs::read(&b.path).unwrap();
    assert_error(
        store.save_as(&a.session_id, 0, b.path.parent().unwrap(), "B.json"),
        "FILE_EXISTS",
    );
    assert_same_snapshot(&store.get(&a.session_id).unwrap(), &a);
    assert_same_snapshot(&store.get(&b.session_id).unwrap(), &b);
    assert_eq!(fs::read(&b.path).unwrap(), bytes);
}

#[test]
fn save_as_preserves_explicit_json_extension_and_accepts_chinese_filename() {
    let base = tempfile::tempdir().unwrap();
    let mut store = DocumentStore::default();
    let a = store.create(Some(base.path()), None, "A", None).unwrap();
    let saved = store
        .save_as(&a.session_id, 0, base.path(), "另存.JSON")
        .unwrap();
    assert_eq!(
        saved.path.file_name().unwrap(),
        Path::new("另存.JSON").as_os_str()
    );
    assert!(saved.path.exists());
}
