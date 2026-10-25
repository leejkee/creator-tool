mod common;
use common::*;
use creator_document_core::validation::{
    FieldRule, ValueKind, Violation, validate_document, validate_fields, validate_json,
};
use creator_document_core::{DocumentStore, ImageDocument};
use serde_json::{Value, json};
use std::fs;

fn field_issues(
    value: Value,
    rules: &[FieldRule],
) -> Vec<creator_document_core::validation::ValidationIssue> {
    validate_fields(value.as_object().unwrap(), "", rules)
}

#[test]
fn presence_nullability_and_empty_strings_are_independent() {
    let rule = FieldRule::required("field", ValueKind::String);
    for (input, expected) in [
        (json!({}), Some(Violation::MissingField)),
        (json!({"field":null}), Some(Violation::NullNotAllowed)),
        (json!({"field":""}), None),
        (json!({"field":"内容"}), None),
    ] {
        let issues = field_issues(input, &[rule]);
        assert_eq!(issues.first().map(|i| i.rule), expected);
    }
    assert!(field_issues(json!({"field":null}), &[rule.nullable().nonempty()]).is_empty());
    assert_eq!(
        field_issues(json!({}), &[rule.nullable()])[0].rule,
        Violation::MissingField
    );
    assert_eq!(
        field_issues(json!({"field":"  \n"}), &[rule.nonempty()])[0].rule,
        Violation::EmptyValue
    );
    assert!(
        field_issues(
            json!({}),
            &[FieldRule::optional("field", ValueKind::String).nonempty()]
        )
        .is_empty()
    );
    assert_eq!(
        field_issues(
            json!({"field":null}),
            &[FieldRule::optional("field", ValueKind::String)]
        )[0]
        .rule,
        Violation::NullNotAllowed
    );
}

#[test]
fn arrays_and_objects_have_explicit_empty_policies_without_treating_false_or_zero_as_empty() {
    for (kind, empty, nonempty) in [
        (ValueKind::Array, json!([]), json!([1])),
        (ValueKind::Object, json!({}), json!({"x":1})),
    ] {
        let rule = FieldRule::required("field", kind);
        assert!(field_issues(json!({"field":empty}), &[rule]).is_empty());
        assert_eq!(
            field_issues(json!({"field":empty}), &[rule.nonempty()])[0].rule,
            Violation::EmptyValue
        );
        assert!(field_issues(json!({"field":nonempty}), &[rule.nonempty()]).is_empty());
    }
    assert!(
        field_issues(
            json!({"field":false}),
            &[FieldRule::required("field", ValueKind::Boolean).nonempty()]
        )
        .is_empty()
    );
    assert!(
        field_issues(
            json!({"field":0}),
            &[FieldRule::required("field", ValueKind::UnsignedInteger).nonempty()]
        )
        .is_empty()
    );
}

#[test]
fn enumerations_are_exact_and_report_type_errors_separately() {
    let rule = FieldRule::optional("mode", ValueKind::String).one_of(&["left", "right"]);
    assert!(field_issues(json!({"mode":"left"}), &[rule]).is_empty());
    for mode in [json!("LEFT"), json!(" left"), json!(""), json!("center")] {
        assert_eq!(
            field_issues(json!({"mode":mode}), &[rule])[0].rule,
            Violation::InvalidEnum
        );
    }
    assert_eq!(
        field_issues(json!({"mode":1}), &[rule])[0].rule,
        Violation::InvalidType
    );
    assert!(field_issues(json!({"mode":null}), &[rule.nullable()]).is_empty());
}

#[test]
fn field_paths_escape_slashes_and_tildes_as_json_pointers() {
    let issues = validate_fields(
        json!({}).as_object().unwrap(),
        "/container",
        &[FieldRule::required("a/b~c", ValueKind::String)],
    );
    assert_eq!(issues[0].path, "/container/a~1b~0c");
}

#[test]
fn document_validation_collects_all_required_fields_without_changing_the_input() {
    let input = json!({});
    let report = validate_document(&input);
    assert!(!report.valid);
    assert_eq!(report.issues.len(), 5);
    assert!(
        report
            .issues
            .iter()
            .all(|i| i.rule == Violation::MissingField)
    );
    assert!(report.issues.iter().any(|i| i.path == "/modules"));
    assert_eq!(input, json!({}));
}

#[test]
fn empty_text_empty_modules_and_empty_groups_are_valid_but_missing_text_is_not() {
    let mut input = document_value();
    input["modules"][0]["children"][1]["module"]["text"] = json!("");
    assert!(validate_document(&input).valid);
    input["modules"][0]["children"][1]["module"]
        .as_object_mut()
        .unwrap()
        .remove("text");
    let report = validate_document(&input);
    assert_eq!(report.issues[0].path, "/modules/0/children/1/module/text");
    assert_eq!(report.issues[0].rule, Violation::MissingField);
    input["modules"][0]["children"] = json!([]);
    assert!(validate_document(&input).valid);
    input["modules"] = json!([]);
    assert!(validate_document(&input).valid);
}

#[test]
fn reports_keep_null_missing_and_empty_array_distinct() {
    let mut input = document_value();
    input["modules"] = Value::Null;
    assert_eq!(
        validate_document(&input).issues[0].rule,
        Violation::NullNotAllowed
    );
    input.as_object_mut().unwrap().remove("modules");
    assert_eq!(
        validate_document(&input).issues[0].rule,
        Violation::MissingField
    );
    input["modules"] = json!([]);
    assert!(validate_document(&input).valid);
}

#[test]
fn nested_errors_include_exact_paths_and_all_node_errors_are_reported() {
    let mut input = document_value();
    input["documentId"] = json!(" ");
    input["modules"][0]["children"][0]["module"]["id"] = json!(" ");
    input["modules"][0]["children"][1]["module"]["fit"] = json!("zoom");
    input["modules"][0]["children"][1]["module"]["style"]["align"] = json!("middle");
    let report = validate_document(&input);
    assert_eq!(report.issues.len(), 4);
    for path in [
        "/documentId",
        "/modules/0/children/0/module/id",
        "/modules/0/children/1/module/fit",
        "/modules/0/children/1/module/style/align",
    ] {
        assert!(
            report.issues.iter().any(|i| i.path == path),
            "missing {path}"
        );
    }
}

#[test]
fn tree_uniqueness_and_leaf_constraints_remain_enforced() {
    let mut input = document_value();
    input["modules"][0]["children"][1]["module"]["id"] = json!("heading");
    input["modules"][0]["type"] = json!("text");
    input["modules"][0]["text"] = json!("");
    let report = validate_document(&input);
    assert!(
        report.issues.iter().any(
            |i| i.rule == Violation::DuplicateId && i.path == "/modules/0/children/1/module/id"
        )
    );
    assert!(
        report
            .issues
            .iter()
            .any(|i| i.rule == Violation::LeafHasChildren && i.path == "/modules/0/children")
    );
}

#[test]
fn optional_enumerations_validate_current_layout_fit_and_alignment_variants() {
    let mut input = document_value();
    for layout in [json!([2, 1]), json!([3, 2]), json!([4, 4])] {
        input["modules"][0]["layout"] = layout;
        assert!(validate_document(&input).valid);
    }
    for layout in [
        json!(null),
        json!({"type":"grid"}),
        json!([1]),
        json!([0, 2]),
        json!([true, 2]),
        json!("column"),
    ] {
        input["modules"][0]["layout"] = layout;
        assert!(
            validate_document(&input)
                .issues
                .iter()
                .any(|i| i.code == "INVALID_LAYOUT")
        );
    }
    input["modules"][0]["layout"] = json!([2, 1]);
    for fit in ["contain", "cover", "stretch", "height", "width"] {
        input["modules"][0]["children"][1]["module"]["fit"] = json!(fit);
        assert!(validate_document(&input).valid);
    }
    for align in ["left", "center", "right"] {
        input["modules"][0]["children"][1]["module"]["style"]["align"] = json!(align);
        assert!(validate_document(&input).valid);
    }
}

#[test]
fn unknown_fields_and_processor_parameters_are_not_recursively_interpreted_as_schema_fields() {
    let mut input = document_value();
    input["futureDocumentField"] = json!({"id":null,"type":"future","fit":"custom"});
    input["modules"][0]["children"][1]["module"]["processor"] =
        json!({"params":{"align":"not-a-style","type":null}});
    input["modules"][0]["children"][1]["module"]["style"]["futureEffect"] =
        json!({"align":"custom"});
    assert!(validate_document(&input).valid);
    let parsed = ImageDocument::parse(&serde_json::to_vec(&input).unwrap()).unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&parsed.encode().unwrap()).unwrap(),
        input
    );
}

#[test]
fn json_text_validation_reports_syntax_errors_bom_and_root_type() {
    let report = validate_json("{broken");
    assert!(!report.valid);
    assert_eq!(report.issues[0].code, "INVALID_JSON");
    assert_eq!(report.issues[0].rule, Violation::InvalidJson);
    assert_eq!(report.issues[0].path, "");
    for text in ["null", "[]", "1"] {
        assert_eq!(validate_json(text).issues[0].rule, Violation::InvalidType);
    }
    let text = format!("\u{feff}{}", document_value());
    assert!(validate_json(&text).valid);
}

#[test]
fn rejected_edits_return_all_issues_and_preserve_document_disk_and_version() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("image.json");
    let bytes = document().encode().unwrap();
    fs::write(&path, &bytes).unwrap();
    let mut store = DocumentStore::default();
    let state = store.open(&path).unwrap();
    let error = store
        .patch_node(
            &state.session_id,
            state.version,
            "body",
            json!({"fit":"bad","style":{"align":"bad"}})
                .as_object()
                .unwrap()
                .clone(),
        )
        .unwrap_err();
    assert_eq!(error.issues.len(), 2);
    assert_eq!(error.issues[0].path, "/modules/0/children/1/module/fit");
    assert_same_snapshot(&store.get(&state.session_id).unwrap(), &state);
    assert_eq!(fs::read(path).unwrap(), bytes);
    assert_eq!(
        serde_json::to_value(&error).unwrap()["issues"][0]["rule"],
        "invalidEnum"
    );
}

#[test]
fn parsing_structural_errors_attaches_field_diagnostics_without_losing_existing_error_code() {
    let mut input = document_value();
    input["modules"] = Value::Null;
    let error = ImageDocument::parse(&serde_json::to_vec(&input).unwrap()).unwrap_err();
    assert_eq!(error.code, "INVALID_JSON");
    assert_eq!(error.issues[0].path, "/modules");
    assert_eq!(error.issues[0].rule, Violation::NullNotAllowed);
}

#[test]
fn semantic_errors_in_external_files_preserve_the_open_document() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("image.json");
    fs::write(&path, document().encode().unwrap()).unwrap();
    let mut store = DocumentStore::default();
    let state = store.open(&path).unwrap();
    let mut external = document_value();
    external["modules"][0]["children"][1]["module"]["fit"] = json!("invalid");
    let bytes = serde_json::to_vec(&external).unwrap();
    fs::write(&path, &bytes).unwrap();
    let changed = store.check(&state.session_id).unwrap();
    assert_eq!(changed.document, state.document);
    match changed.external_change.as_ref().unwrap() {
        creator_document_core::ExternalChange::Modified {
            document: None,
            error: Some(error),
        } => {
            assert_eq!(error.issues[0].path, "/modules/0/children/1/module/fit");
        }
        other => panic!("Expected invalid candidate, got {other:?}"),
    }
    assert_error(
        store.save(&state.session_id, changed.version),
        "EXTERNAL_CHANGE",
    );
    assert_error(
        store.reload(&state.session_id, changed.version, true),
        "INVALID_FIT",
    );
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert_same_snapshot(&store.get(&state.session_id).unwrap(), &changed);
}

#[test]
fn json_text_validation_matches_the_loader_for_duplicate_structural_fields() {
    let text = serde_json::to_string(&document_value()).unwrap();
    let duplicate = text.replacen("{", "{\"revision\":0,", 1);
    assert_error(ImageDocument::parse(duplicate.as_bytes()), "INVALID_JSON");
    let report = validate_json(&duplicate);
    assert!(!report.valid);
    assert_eq!(report.issues[0].rule, Violation::InvalidJson);
}
