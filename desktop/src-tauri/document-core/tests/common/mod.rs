use creator_document_core::{DocumentError, ImageDocument, Snapshot};
use serde_json::{Value, json};

pub fn document_value() -> Value {
    json!({
        "image-create-tool-version": "v0.1.0",
        "documentId": "example-image",
        "revision": 0,
        "title": "图片示例",
        "sourceNotes": "保留原始笔记，不改变用户决策。",
        "composition": {"width": 1000, "height": "auto", "background": "#152030"},
        "futureDocumentField": {"enabled": true},
        "modules": [{
            "id": "section", "type": "group", "layout": [2, 1],
            "elements": [
                {"id": "heading", "type": "text", "text": "标题", "style": {"fontSize": 44}},
                {"id": "body", "type": "text", "text": "正文", "style": {"color": "#FFFFFF"}, "futureNodeField": [1, 2]}
            ]
        }]
    })
}

pub fn document() -> ImageDocument {
    ImageDocument::parse(&serde_json::to_vec(&document_value()).unwrap()).unwrap()
}

pub fn assert_error<T: std::fmt::Debug>(result: Result<T, DocumentError>, code: &str) {
    assert_eq!(result.unwrap_err().code, code);
}

// Compare the whole public snapshot so rejected actions cannot silently alter other state.
#[allow(dead_code)]
pub fn assert_same_snapshot(actual: &Snapshot, expected: &Snapshot) {
    assert_eq!(
        serde_json::to_value(actual).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
}
