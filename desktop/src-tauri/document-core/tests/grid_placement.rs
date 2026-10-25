mod common;
use common::*;
use creator_document_core::{
    DocumentStore, ImageDocument,
    validation::{Violation, validate_document},
};
use serde_json::{Value, json};
use std::fs;

fn nested_document() -> Value {
    let mut value = document_value();
    value["modules"][0]["children"][1]["module"] = json!({
        "id":"nested", "type":"group", "layout":[2,1],
        "children":[{"position":[0,0], "module":{"id":"nested-text","type":"text","text":"嵌套内容"}}]
    });
    value
}

#[test]
fn placements_and_modules_round_trip_with_unknown_placement_metadata() {
    let mut value = nested_document();
    value["modules"][0]["children"][0]["futurePlacement"] = json!({"label":"首格"});
    let document = ImageDocument::from_value(value.clone()).unwrap();
    assert_eq!(document.modules[0].layout, Some((2, 1)));
    assert_eq!(document.modules[0].children[1].position, (1, 0));
    assert_eq!(
        document.modules[0].children[1].module.children[0].position,
        (0, 0)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&document.encode().unwrap()).unwrap(),
        value
    );
}

#[test]
fn grid_order_is_defined_by_coordinates_and_spare_cells_are_allowed() {
    let mut value = document_value();
    value["modules"][0]["layout"] = json!([3, 4]);
    value["modules"][0]["children"]
        .as_array_mut()
        .unwrap()
        .reverse();
    let parsed = ImageDocument::from_value(value).unwrap();
    let body = &parsed.modules[0].children[0];
    assert_eq!(body.module.id, "body");
    assert_eq!(body.position, (1, 0));
    assert_eq!(parsed.modules[0].children[1].position, (0, 0));
    assert_eq!(
        ImageDocument::parse(&parsed.encode().unwrap()).unwrap(),
        parsed
    );
}

#[test]
fn empty_groups_still_require_positive_layout_dimensions() {
    let mut value = document_value();
    value["modules"][0]["children"] = json!([]);
    assert!(validate_document(&value).valid);
    value["modules"][0]
        .as_object_mut()
        .unwrap()
        .remove("children");
    assert!(validate_document(&value).valid);
    value["modules"][0]
        .as_object_mut()
        .unwrap()
        .remove("layout");
    let report = validate_document(&value);
    assert_eq!(report.issues[0].path, "/modules/0/layout");
    assert_eq!(report.issues[0].rule, Violation::MissingField);
}

#[test]
fn layout_dimensions_reject_zero_negative_floats_booleans_overflow_and_old_modes() {
    for layout in [
        json!([0, 1]),
        json!([-1, 2]),
        json!([1.5, 2]),
        json!([true, 2]),
        json!([4294967296_u64, 1]),
        json!([1]),
        json!([1, 2, 3]),
        json!({"type":"grid","rows":2,"columns":1}),
    ] {
        let mut value = document_value();
        value["modules"][0]["layout"] = layout;
        let report = validate_document(&value);
        assert!(
            report
                .issues
                .iter()
                .any(|i| i.code == "INVALID_LAYOUT" && i.path == "/modules/0/layout")
        );
        assert!(ImageDocument::from_value(value).is_err());
    }
}

#[test]
fn positions_are_required_nonnegative_u32_pairs() {
    for position in [
        json!([-1, 0]),
        json!([0.5, 0]),
        json!([true, 0]),
        json!([0]),
        json!([0, 0, 0]),
        json!([4294967296_u64, 0]),
        json!(null),
    ] {
        let mut value = document_value();
        value["modules"][0]["children"][0]["position"] = position;
        assert!(validate_document(&value).issues.iter().any(|i| i.code=="INVALID_POSITION" && i.path=="/modules/0/children/0/position"));
    }
    let mut value = document_value();
    value["modules"][0]["children"][0]
        .as_object_mut()
        .unwrap()
        .remove("position");
    assert_eq!(
        validate_document(&value).issues[0].rule,
        Violation::MissingField
    );
}

#[test]
fn collision_and_bounds_are_checked_against_the_immediate_parent() {
    let mut value = nested_document();
    assert!(validate_document(&value).valid); // Different groups may both use [0,0].
    value["modules"][0]["children"][1]["position"] = json!([0, 0]);
    let report = validate_document(&value);
    assert!(
        report
            .issues
            .iter()
            .any(|i| i.rule == Violation::DuplicatePosition
                && i.path == "/modules/0/children/1/position")
    );
    value["modules"][0]["children"][1]["position"] = json!([1, 0]);
    value["modules"][0]["children"][1]["module"]["children"][0]["position"] = json!([2, 0]);
    assert!(
        validate_document(&value)
            .issues
            .iter()
            .any(|i| i.rule == Violation::PositionOutOfBounds
                && i.path == "/modules/0/children/1/module/children/0/position")
    );
    value["modules"][0]["children"][1]["module"]["children"][0]["position"] = json!([0, 1]);
    assert!(
        validate_document(&value)
            .issues
            .iter()
            .any(|i| i.rule == Violation::PositionOutOfBounds)
    );
}

#[test]
fn placements_require_module_objects_and_spans_are_explicitly_unsupported() {
    for placement in [
        json!(42),
        json!({"position":[0,0]}),
        json!({"position":[0,0],"module":null}),
        json!({"position":[0,0],"module":{}}),
    ] {
        let mut value = document_value();
        value["modules"][0]["children"][0] = placement;
        assert!(!validate_document(&value).valid);
    }
    let mut value = document_value();
    value["modules"][0]["children"][0]["span"] = json!([1, 2]);
    assert!(
        validate_document(&value)
            .issues
            .iter()
            .any(|i| i.rule == Violation::UnsupportedField)
    );
}

#[test]
fn leaf_modules_cannot_own_a_grid_or_contain_children() {
    let mut value = document_value();
    value["modules"][0]["children"][0]["module"]["layout"] = json!([1, 1]);
    assert!(!validate_document(&value).valid);
    value["modules"][0]["children"][0]["module"]
        .as_object_mut()
        .unwrap()
        .remove("layout");
    value["modules"][0]["children"][0]["module"]["children"] =
        json!([{"position":[0,0],"module":{"id":"illegal","type":"rect"}}]);
    assert!(
        validate_document(&value)
            .issues
            .iter()
            .any(|i| i.rule == Violation::LeafHasChildren)
    );
}

#[test]
fn legacy_structure_and_intrinsic_positions_are_rejected_without_changing_files() {
    let mut legacy = document_value();
    legacy["image-create-tool-version"] = json!("v0.1.0");
    legacy["modules"][0]["elements"] = json!([]);
    legacy["modules"][0]["layout"] = json!({"type":"row"});
    assert_error(
        ImageDocument::parse(&serde_json::to_vec(&legacy).unwrap()),
        "UNSUPPORTED_FORMAT",
    );
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("old.json");
    let bytes = serde_json::to_vec(&legacy).unwrap();
    fs::write(&path, &bytes).unwrap();
    let mut store = DocumentStore::default();
    assert!(store.open(&path).is_err());
    assert_eq!(fs::read(path).unwrap(), bytes);
    assert!(store.list().is_empty());
    for key in ["elements", "position"] {
        let mut value = document_value();
        value["modules"][0][key] = json!([]);
        assert!(
            validate_document(&value)
                .issues
                .iter()
                .any(|i| i.code == "UNSUPPORTED_STRUCTURE")
        );
    }
}

#[test]
fn moving_and_resizing_preserve_identity_content_and_disk_until_save() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("grid.json");
    let original = document().encode().unwrap();
    fs::write(&path, &original).unwrap();
    let mut store = DocumentStore::default();
    let state = store.open(&path).unwrap();
    let expanded = store
        .set_group_layout(&state.session_id, 0, "section", (3, 2))
        .unwrap();
    assert_eq!(expanded.document.modules[0].layout, Some((3, 2)));
    let moved = store
        .set_module_position(
            &state.session_id,
            expanded.version,
            "section",
            "body",
            (2, 1),
        )
        .unwrap();
    let placed = &moved.document.modules[0].children[1];
    assert_eq!(placed.position, (2, 1));
    assert_eq!(placed.module, state.document.modules[0].children[1].module);
    assert_eq!(moved.document.properties, state.document.properties);
    assert_eq!((moved.version, moved.document.revision), (2, 2));
    assert!(moved.dirty);
    assert_eq!(fs::read(&path).unwrap(), original);
    let saved = store.save(&state.session_id, moved.version).unwrap();
    assert!(!saved.dirty);
    let reopened = DocumentStore::default().open(&path).unwrap();
    assert_eq!(reopened.document, saved.document);
}

#[test]
fn rejected_grid_edits_are_atomic_and_versions_remain_unchanged() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("grid.json");
    let bytes = document().encode().unwrap();
    fs::write(&path, &bytes).unwrap();
    let mut store = DocumentStore::default();
    let state = store.open(&path).unwrap();
    assert_error(
        store.set_module_position(&state.session_id, 0, "section", "body", (0, 0)),
        "POSITION_OCCUPIED",
    );
    assert_error(
        store.set_module_position(&state.session_id, 0, "section", "body", (2, 0)),
        "POSITION_OUT_OF_BOUNDS",
    );
    assert_error(
        store.set_group_layout(&state.session_id, 0, "section", (1, 1)),
        "POSITION_OUT_OF_BOUNDS",
    );
    assert_error(
        store.set_group_layout(&state.session_id, 0, "section", (0, 1)),
        "INVALID_LAYOUT",
    );
    assert_same_snapshot(&store.get(&state.session_id).unwrap(), &state);
    assert_eq!(fs::read(&path).unwrap(), bytes);
}

#[test]
fn nested_grid_editing_uses_direct_parent_membership_and_global_ids() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("nested.json");
    fs::write(&path, serde_json::to_vec(&nested_document()).unwrap()).unwrap();
    let mut store = DocumentStore::default();
    let state = store.open(&path).unwrap();
    assert_error(
        store.set_module_position(&state.session_id, 0, "section", "nested-text", (0, 0)),
        "CHILD_NOT_FOUND",
    );
    assert_error(
        store.set_group_layout(&state.session_id, 0, "heading", (1, 1)),
        "NOT_A_GROUP",
    );
    assert_error(
        store.set_group_layout(&state.session_id, 0, "missing", (1, 1)),
        "NODE_NOT_FOUND",
    );
    let moved = store
        .set_module_position(&state.session_id, 0, "nested", "nested-text", (1, 0))
        .unwrap();
    assert_error(
        store.set_group_layout(&state.session_id, 0, "nested", (3, 1)),
        "STALE_VERSION",
    );
    assert_error(
        store.set_module_position(&state.session_id, 0, "nested", "nested-text", (0, 0)),
        "STALE_VERSION",
    );
    let edited = store
        .patch_node(
            &state.session_id,
            moved.version,
            "nested-text",
            json!({"text":"更新嵌套文字"}).as_object().unwrap().clone(),
        )
        .unwrap();
    let nested = &edited.document.modules[0].children[1].module.children[0];
    assert_eq!(nested.position, (1, 0));
    assert_eq!(nested.module.properties["text"], "更新嵌套文字");
}

#[test]
fn no_op_layout_and_position_changes_do_not_increment_versions() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("image.json");
    fs::write(&path, document().encode().unwrap()).unwrap();
    let mut store = DocumentStore::default();
    let state = store.open(&path).unwrap();
    assert_same_snapshot(
        &store
            .set_group_layout(&state.session_id, 0, "section", (2, 1))
            .unwrap(),
        &state,
    );
    assert_same_snapshot(
        &store
            .set_module_position(&state.session_id, 0, "section", "body", (1, 0))
            .unwrap(),
        &state,
    );
}

#[test]
fn documented_example_uses_the_current_protocol_and_round_trips() {
    let bytes = include_bytes!("../../../examples/grid.image.json");
    let document = ImageDocument::parse(bytes).unwrap();
    assert_eq!(document.format, creator_document_core::DOCUMENT_VERSION);
    assert_eq!(document.modules[0].layout, Some((2, 2)));
    assert_eq!(document.modules[0].children[1].module.layout, Some((3, 1)));
    assert_eq!(
        ImageDocument::parse(&document.encode().unwrap()).unwrap(),
        document
    );
}

#[test]
fn external_grid_collision_is_a_candidate_error_and_does_not_replace_memory() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("image.json");
    fs::write(&path, document().encode().unwrap()).unwrap();
    let mut store = DocumentStore::default();
    let state = store.open(&path).unwrap();
    let mut external = document_value();
    external["modules"][0]["children"][1]["position"] = json!([0, 0]);
    let bytes = serde_json::to_vec(&external).unwrap();
    fs::write(&path, &bytes).unwrap();
    let candidate = store.check(&state.session_id).unwrap();
    assert_eq!(candidate.document, state.document);
    match candidate.external_change.as_ref().unwrap() {
        creator_document_core::ExternalChange::Modified {
            document: None,
            error: Some(error),
        } => {
            assert_eq!(error.code, "POSITION_OCCUPIED");
            assert_eq!(error.issues[0].path, "/modules/0/children/1/position");
        }
        other => panic!("Expected rejected collision, got {other:?}"),
    }
    assert_error(
        store.save(&state.session_id, candidate.version),
        "EXTERNAL_CHANGE",
    );
    assert_error(
        store.reload(&state.session_id, candidate.version, true),
        "POSITION_OCCUPIED",
    );
    assert_same_snapshot(&store.get(&state.session_id).unwrap(), &candidate);
    assert_eq!(fs::read(&path).unwrap(), bytes);
}
