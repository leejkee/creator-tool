//! Small declarative field rules plus document-specific tree checks.
//! Unknown fields are preserved; rules inspect only declared locations.
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashSet;

#[derive(Debug, Clone, Copy)]
pub enum ValueKind {
    String,
    Object,
    Array,
    UnsignedInteger,
    Boolean,
}
impl ValueKind {
    fn accepts(self, value: &Value) -> bool {
        match self {
            Self::String => value.is_string(),
            Self::Object => value.is_object(),
            Self::Array => value.is_array(),
            Self::UnsignedInteger => value.as_u64().is_some(),
            Self::Boolean => value.is_boolean(),
        }
    }
}

/// Presence, nullability, emptiness and enumeration are independent constraints.
#[derive(Debug, Clone, Copy)]
pub struct FieldRule {
    pub name: &'static str,
    pub kind: ValueKind,
    pub required: bool,
    pub nullable: bool,
    pub allow_empty: bool,
    pub choices: &'static [&'static str],
    pub code: &'static str,
}
impl FieldRule {
    pub const fn required(name: &'static str, kind: ValueKind) -> Self {
        Self {
            name,
            kind,
            required: true,
            nullable: false,
            allow_empty: true,
            choices: &[],
            code: "INVALID_FIELD",
        }
    }
    pub const fn optional(name: &'static str, kind: ValueKind) -> Self {
        Self {
            required: false,
            ..Self::required(name, kind)
        }
    }
    pub const fn nonempty(self) -> Self {
        Self {
            allow_empty: false,
            ..self
        }
    }
    pub const fn nullable(self) -> Self {
        Self {
            nullable: true,
            ..self
        }
    }
    pub const fn one_of(self, choices: &'static [&'static str]) -> Self {
        Self { choices, ..self }
    }
    pub const fn code(self, code: &'static str) -> Self {
        Self { code, ..self }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Violation {
    MissingField,
    NullNotAllowed,
    InvalidType,
    EmptyValue,
    InvalidEnum,
    DuplicateId,
    LeafHasChildren,
    InvalidLayout,
    InvalidJson,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ValidationIssue {
    pub code: String,
    pub rule: Violation,
    /// RFC 6901 JSON Pointer; the empty string denotes the document root.
    pub path: String,
    pub message: String,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ValidationReport {
    pub valid: bool,
    pub issues: Vec<ValidationIssue>,
}
impl ValidationReport {
    fn from_issues(issues: Vec<ValidationIssue>) -> Self {
        Self {
            valid: issues.is_empty(),
            issues,
        }
    }
    pub(crate) fn into_result(self) -> crate::Result<()> {
        if let Some(issue) = self.issues.first() {
            let mut error = crate::DocumentError::new(
                &issue.code,
                format!("{}: {}", issue.path, issue.message),
            );
            error.issues = self.issues;
            Err(error)
        } else {
            Ok(())
        }
    }
}
fn issue(code: &str, rule: Violation, path: &str, message: impl Into<String>) -> ValidationIssue {
    ValidationIssue {
        code: code.into(),
        rule,
        path: path.into(),
        message: message.into(),
    }
}
fn child(path: &str, key: &str) -> String {
    format!("{}/{}", path, key.replace('~', "~0").replace('/', "~1"))
}

/// Generic rules can also be used for future schema fields without changing the engine.
pub fn validate_fields(
    object: &Map<String, Value>,
    path: &str,
    rules: &[FieldRule],
) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    for rule in rules {
        let field_path = child(path, rule.name);
        let Some(value) = object.get(rule.name) else {
            if rule.required {
                issues.push(issue(
                    rule.code,
                    Violation::MissingField,
                    &field_path,
                    "Required field is missing",
                ));
            }
            continue;
        };
        if value.is_null() {
            if !rule.nullable {
                issues.push(issue(
                    rule.code,
                    Violation::NullNotAllowed,
                    &field_path,
                    "null is not allowed",
                ));
            }
            continue;
        }
        if !rule.kind.accepts(value) {
            issues.push(issue(
                rule.code,
                Violation::InvalidType,
                &field_path,
                format!("Expected {:?}", rule.kind),
            ));
            continue;
        }
        let empty = match value {
            Value::String(s) => s.trim().is_empty(),
            Value::Array(a) => a.is_empty(),
            Value::Object(o) => o.is_empty(),
            _ => false,
        };
        if !rule.allow_empty && empty {
            issues.push(issue(
                rule.code,
                Violation::EmptyValue,
                &field_path,
                "Value must not be empty",
            ));
            continue;
        }
        if !rule.choices.is_empty() && !value.as_str().is_some_and(|s| rule.choices.contains(&s)) {
            issues.push(issue(
                rule.code,
                Violation::InvalidEnum,
                &field_path,
                format!("Allowed values: {}", rule.choices.join(", ")),
            ));
        }
    }
    issues
}

use ValueKind::{Array, Object, String as Text, UnsignedInteger};
const NODE_TYPES: &[&str] = &["text", "image", "rect", "group"];
const FIT: &[&str] = &["contain", "cover", "stretch", "height", "width"];
const ALIGN: &[&str] = &["left", "center", "right"];
const LAYOUT: &[&str] = &["column", "row", "grid", "fixed"];
const DOCUMENT: &[FieldRule] = &[
    FieldRule::required("image-create-tool-version", Text)
        .nonempty()
        .one_of(&["v0.1.0"])
        .code("UNSUPPORTED_FORMAT"),
    FieldRule::required("documentId", Text)
        .nonempty()
        .code("INVALID_DOCUMENT"),
    FieldRule::required("revision", UnsignedInteger).code("INVALID_REVISION"),
    FieldRule::required("composition", Object).code("INVALID_DOCUMENT"),
    FieldRule::required("modules", Array).code("INVALID_DOCUMENT"),
];
const NODE: &[FieldRule] = &[
    FieldRule::required("id", Text)
        .nonempty()
        .code("INVALID_NODE_ID"),
    FieldRule::required("type", Text)
        .nonempty()
        .one_of(NODE_TYPES)
        .code("INVALID_NODE_TYPE"),
    FieldRule::optional("elements", Array).code("INVALID_NODE"),
    FieldRule::optional("fit", Text)
        .one_of(FIT)
        .code("INVALID_FIT"),
];
const STYLE: &[FieldRule] = &[FieldRule::optional("align", Text)
    .one_of(ALIGN)
    .code("INVALID_STYLE")];

fn check_layout(value: &Value, path: &str, issues: &mut Vec<ValidationIssue>) {
    match value {
        Value::Object(layout) => {
            issues.extend(validate_fields(
                layout,
                path,
                &[FieldRule::optional("type", Text)
                    .one_of(LAYOUT)
                    .code("INVALID_LAYOUT")],
            ));
        }
        Value::Array(dimensions)
            if dimensions.len() == 2
                && dimensions.iter().all(|v| v.as_u64().is_some_and(|n| n > 0)) => {}
        _ => issues.push(issue(
            "INVALID_LAYOUT",
            Violation::InvalidLayout,
            path,
            "Expected a layout object or positive integer [rows, columns]",
        )),
    }
}
fn visit(
    nodes: &[Value],
    path: &str,
    ids: &mut HashSet<std::string::String>,
    issues: &mut Vec<ValidationIssue>,
) {
    for (index, value) in nodes.iter().enumerate() {
        let path = child(path, &index.to_string());
        let Some(node) = value.as_object() else {
            issues.push(issue(
                "INVALID_NODE",
                Violation::InvalidType,
                &path,
                "Expected a node object",
            ));
            continue;
        };
        issues.extend(validate_fields(node, &path, NODE));
        if let Some(id) = node
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.trim().is_empty())
            && !ids.insert(id.into())
        {
            issues.push(issue(
                "INVALID_NODE_ID",
                Violation::DuplicateId,
                &child(&path, "id"),
                "Node IDs must be unique throughout the document",
            ));
        }
        if node.get("type").and_then(Value::as_str) == Some("text") {
            issues.extend(validate_fields(
                node,
                &path,
                &[FieldRule::required("text", Text).code("INVALID_NODE")],
            ));
        }
        if let Some(layout) = node.get("layout") {
            check_layout(layout, &child(&path, "layout"), issues);
        }
        if let Some(style) = node.get("style").and_then(Value::as_object) {
            issues.extend(validate_fields(style, &child(&path, "style"), STYLE));
        }
        if let Some(children) = node.get("elements").and_then(Value::as_array) {
            if matches!(
                node.get("type").and_then(Value::as_str),
                Some("text" | "image" | "rect")
            ) && !children.is_empty()
            {
                issues.push(issue(
                    "INVALID_NODE",
                    Violation::LeafHasChildren,
                    &child(&path, "elements"),
                    "Leaf nodes cannot contain children",
                ));
            }
            visit(children, &child(&path, "elements"), ids, issues);
        }
    }
}

/// Inspect the original JSON so missing fields and explicit null stay distinguishable.
pub fn validate_document(value: &Value) -> ValidationReport {
    let Some(document) = value.as_object() else {
        return ValidationReport::from_issues(vec![issue(
            "INVALID_DOCUMENT",
            Violation::InvalidType,
            "",
            "Expected a document object",
        )]);
    };
    let mut issues = validate_fields(document, "", DOCUMENT);
    if let Some(nodes) = document.get("modules").and_then(Value::as_array) {
        visit(nodes, "/modules", &mut HashSet::new(), &mut issues);
    }
    ValidationReport::from_issues(issues)
}

/// Editor-facing validation accepts raw JSON text, including BOM, without opening a session.
pub fn validate_json(text: &str) -> ValidationReport {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    match serde_json::from_str::<Value>(text) {
        Ok(value) => {
            let report = validate_document(&value);
            // Value maps collapse duplicate keys; the document deserializer rejects
            // duplicate structural fields, so verify it before reporting success.
            if report.valid
                && let Err(error) = serde_json::from_str::<crate::ImageDocument>(text)
            {
                return ValidationReport::from_issues(vec![issue(
                    "INVALID_JSON",
                    Violation::InvalidJson,
                    "",
                    error.to_string(),
                )]);
            }
            report
        }
        Err(error) => ValidationReport::from_issues(vec![issue(
            "INVALID_JSON",
            Violation::InvalidJson,
            "",
            error.to_string(),
        )]),
    }
}
