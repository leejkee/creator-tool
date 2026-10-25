//! Validate the whole recipe before making an independent, one-shot styled module.
use crate::validation::{
    self, FieldRule, ValidationIssue, ValidationReport, ValueKind, Violation, child, issue,
};
use crate::{DocumentError, DocumentStore, ModuleType, Node, Result, Snapshot, StyleNode};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

// The single list defines both accepted parameters and parameters reset by application.
// Content, identity and parent placement are deliberately excluded.
// The typed processors field is replaced separately alongside these parameters.
const RENDER_FIELDS: &[&str] = &[
    "width",
    "height",
    "fit",
    "contentScale",
    "offsetX",
    "offsetY",
    "zIndex",
    "padding",
    "gap",
    "rowGap",
    "columnGap",
];
const METADATA: &[&str] = &["name", "description", "version"];

fn validate_style(root: &StyleNode) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    let mut pending = vec![(root, "/style".to_string())];
    while let Some((style, path)) = pending.pop() {
        let group = style.kind == ModuleType::Group;
        if !style.processors.is_empty() {
            match serde_json::to_value(&style.processors) {
                Ok(value) => issues.extend(crate::processors::validate_processors(
                    &value,
                    &child(&path, "processors"),
                    style.kind == ModuleType::Image,
                )),
                Err(error) => issues.push(issue(
                    "SERIALIZE_FAILED",
                    Violation::InvalidJson,
                    &child(&path, "processors"),
                    error.to_string(),
                )),
            }
        }
        if style
            .layout
            .is_some_and(|(rows, columns)| rows == 0 || columns == 0)
            || (!group && style.layout.is_some())
            || (!style.children.is_empty() && (!group || style.layout.is_none()))
        {
            issues.push(issue(
                "INVALID_STYLE",
                Violation::InvalidLayout,
                &child(&path, "layout"),
                "Only groups may have a positive layout; child recipes require a layout",
            ));
        }
        for key in style.properties.keys() {
            if !RENDER_FIELDS.contains(&key.as_str()) && !METADATA.contains(&key.as_str()) {
                issues.push(issue(
                    "UNSUPPORTED_STYLE",
                    Violation::UnsupportedField,
                    &child(&path, key),
                    "Not a supported Style render parameter; content and identity cannot be styled",
                ));
            }
        }
        issues.extend(validation::validate_fields(
            &style.properties,
            &path,
            &[FieldRule::optional("fit", ValueKind::String)
                .one_of(validation::FIT)
                .code("INVALID_STYLE")],
        ));
        for (key, value) in &style.properties {
            let valid = match key.as_str() {
                "width" | "height" => value.as_str() == Some("auto") || positive(value),
                "contentScale" => positive(value),
                "gap" | "rowGap" | "columnGap" | "padding" => nonnegative(value),
                "offsetX" | "offsetY" | "zIndex" => value.as_f64().is_some_and(f64::is_finite),
                _ => true,
            };
            if !valid {
                issues.push(issue(
                    "INVALID_STYLE",
                    Violation::InvalidType,
                    &child(&path, key),
                    "Expected a finite number in the allowed range (width/height also accept auto)",
                ));
            }
        }
        if let Some(visual) = &style.style {
            let visual_path = child(&path, "style");
            issues.extend(validation::validate_fields(
                visual,
                &visual_path,
                validation::STYLE,
            ));
            for (key, value) in visual {
                let valid = match key.as_str() {
                    "fontSize" | "lineHeight" => positive(value),
                    "radius" => nonnegative(value),
                    "opacity" => value
                        .as_f64()
                        .is_some_and(|v| v.is_finite() && (0.0..=1.0).contains(&v)),
                    "bold" => value.is_boolean(),
                    "font" | "color" => value.as_str().is_some_and(|v| !v.trim().is_empty()),
                    "background" => {
                        value.as_str().is_some_and(|v| !v.trim().is_empty()) || value.is_object()
                    }
                    "border" => value.is_object(),
                    // Preserve visual extensions; renderer-specific semantics are a later layer.
                    _ => true,
                };
                if !valid {
                    issues.push(issue(
                        "INVALID_STYLE",
                        Violation::InvalidType,
                        &child(&visual_path, key),
                        "Invalid visual parameter type or numeric range",
                    ));
                }
            }
        }
        let mut occupied = BTreeSet::new();
        for (index, placed) in style.children.iter().enumerate() {
            let placed_path = format!("{path}/children/{index}");
            if !occupied.insert(placed.position) {
                issues.push(issue(
                    "INVALID_STYLE",
                    Violation::DuplicatePosition,
                    &child(&placed_path, "position"),
                    "Only one child recipe may occupy a cell",
                ));
            }
            if style.layout.is_some_and(|(rows, columns)| {
                placed.position.0 >= rows || placed.position.1 >= columns
            }) {
                issues.push(issue(
                    "INVALID_STYLE",
                    Violation::PositionOutOfBounds,
                    &child(&placed_path, "position"),
                    "Style child lies outside its grid",
                ));
            }
            if placed.properties.contains_key("span") {
                issues.push(issue(
                    "INVALID_STYLE",
                    Violation::UnsupportedField,
                    &child(&placed_path, "span"),
                    "Spanning multiple cells is not supported",
                ));
            }
            pending.push((&placed.module, child(&placed_path, "module")));
        }
    }
    issues
}

fn positive(value: &Value) -> bool {
    value.as_f64().is_some_and(|v| v.is_finite() && v > 0.0)
}
fn nonnegative(value: &Value) -> bool {
    value.as_f64().is_some_and(|v| v.is_finite() && v >= 0.0)
}

fn module_report(image: &Node) -> ValidationReport {
    match serde_json::to_value(image) {
        Ok(value) => validation::validate_module(&value),
        Err(error) => ValidationReport::from_issues(vec![issue(
            "SERIALIZE_FAILED",
            Violation::InvalidJson,
            "",
            error.to_string(),
        )]),
    }
}

/// Checks both inputs and matches child recipes by grid position, never by ID or array order.
/// Diagnostic paths begin with /image or /style. Neither input is changed.
pub fn check_style_applicability(image: &Node, style: &StyleNode) -> ValidationReport {
    let mut issues = module_report(image).issues;
    for diagnostic in &mut issues {
        diagnostic.path.insert_str(0, "/image");
    }
    issues.extend(validate_style(style));
    if !issues.is_empty() {
        return ValidationReport::from_issues(issues);
    }
    let mut pending = vec![(image, style, "/style".to_string())];
    while let Some((target, recipe, path)) = pending.pop() {
        let expected = match recipe.kind {
            ModuleType::Text => "text",
            ModuleType::Image => "image",
            ModuleType::Rect => "rect",
            ModuleType::Group => "group",
        };
        if target.kind != expected {
            issues.push(issue(
                "STYLE_MISMATCH",
                Violation::InvalidType,
                &child(&path, "type"),
                format!(
                    "Style type {expected} does not match target type {}",
                    target.kind
                ),
            ));
            continue;
        }
        if recipe.layout.is_some() && recipe.layout != target.layout {
            issues.push(issue(
                "STYLE_MISMATCH",
                Violation::InvalidLayout,
                &child(&path, "layout"),
                "Style and target must have the same grid dimensions",
            ));
        }
        // An empty recipe styles only the container, leaving descendants untouched.
        if recipe.children.is_empty() {
            continue;
        }
        let targets: BTreeMap<_, _> = target
            .children
            .iter()
            .map(|p| (p.position, &p.module))
            .collect();
        let positions: BTreeSet<_> = recipe.children.iter().map(|p| p.position).collect();
        if positions != targets.keys().copied().collect() {
            issues.push(issue(
                "STYLE_MISMATCH",
                Violation::InvalidPosition,
                &child(&path, "children"),
                "Style and target must occupy exactly the same cells",
            ));
        }
        for (index, placed) in recipe.children.iter().enumerate() {
            if let Some(target) = targets.get(&placed.position) {
                pending.push((
                    *target,
                    &placed.module,
                    format!("{path}/children/{index}/module"),
                ));
            }
        }
    }
    ValidationReport::from_issues(issues)
}

/// Validate first, then return an independent module with materialized parameters.
/// Omitted parameters/processing are removed; content, IDs, structure and metadata survive.
pub fn apply_style(image: &Node, style: &StyleNode) -> Result<Node> {
    check_style_applicability(image, style).into_result()?;
    let mut result = image.clone();
    let mut pending = vec![(&mut result, style)];
    while let Some((target, recipe)) = pending.pop() {
        target.processors.clone_from(&recipe.processors);
        target.properties.remove("style");
        if let Some(visual) = &recipe.style {
            target
                .properties
                .insert("style".into(), Value::Object(visual.clone()));
        }
        for key in RENDER_FIELDS {
            target.properties.remove(*key);
            if let Some(value) = recipe.properties.get(*key) {
                target.properties.insert((*key).into(), value.clone());
            }
        }
        let recipes: BTreeMap<_, _> = recipe
            .children
            .iter()
            .map(|p| (p.position, &p.module))
            .collect();
        for placed in &mut target.children {
            if let Some(recipe) = recipes.get(&placed.position) {
                pending.push((&mut placed.module, *recipe));
            }
        }
    }
    module_report(&result).into_result()?;
    Ok(result)
}

impl DocumentStore {
    /// Apply to the authoritative session in one commit, with normal version/dirty handling.
    pub fn apply_style(
        &mut self,
        id: &str,
        expected: u64,
        module_id: &str,
        style: &StyleNode,
    ) -> Result<Snapshot> {
        let session = self.session(id)?;
        session.require_version(expected)?;
        let mut document = session.state.document.clone();
        let target = crate::grid::find_node_mut(&mut document.modules, module_id)
            .ok_or_else(|| DocumentError::new("NODE_NOT_FOUND", module_id))?;
        *target = apply_style(target, style)?;
        session.commit(document)
    }
}
