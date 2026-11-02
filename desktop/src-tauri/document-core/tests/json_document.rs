mod common;
use common::*;
use creator_document_core::ImageDocument;
use serde_json::{Value, json};

#[test]
fn round_trip_preserves_chinese_unknown_fields_and_nested_modules() {
    let input = document_value();
    let parsed = document();
    let bytes = parsed.encode().unwrap();
    assert_eq!(ImageDocument::parse(&bytes).unwrap(), parsed);
    assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(), input);
}

#[test]
fn utf8_bom_is_accepted_without_becoming_document_content() {
    let mut bytes = vec![0xef, 0xbb, 0xbf];
    bytes.extend(serde_json::to_vec(&document_value()).unwrap());
    assert_eq!(ImageDocument::parse(&bytes).unwrap(), document());
}

#[test]
fn malformed_json_and_invalid_required_field_types_are_rejected() {
    for bytes in [b"{broken".as_slice(), b"{}", b"null", b"[]", b"\xff"] {
        assert_error(ImageDocument::parse(bytes), "INVALID_JSON");
    }
    for (field, value) in [
        ("revision", json!(-1)),
        ("revision", json!(1.5)),
        ("revision", json!("0")),
        ("composition", json!([])),
        ("modules", json!({})),
    ] {
        let mut input = document_value();
        input[field] = value;
        assert_error(
            ImageDocument::parse(&serde_json::to_vec(&input).unwrap()),
            "INVALID_JSON",
        );
    }
}

#[test]
fn all_current_node_types_can_be_serialized() {
    let mut doc = document();
    for (index, kind) in ["image", "rect", "group"].iter().enumerate() {
        let mut node = doc.modules[0].children[0].module.clone();
        node.id = format!("extra-{index}");
        node.kind = kind.to_string();
        if *kind == "group" {
            node.layout = Some((1, 1));
        }
        doc.modules.push(node);
    }
    assert_eq!(ImageDocument::parse(&doc.encode().unwrap()).unwrap(), doc);
}
