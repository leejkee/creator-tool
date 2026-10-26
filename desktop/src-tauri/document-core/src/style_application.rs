//! One-shot Style application without document or recipe validation.
use crate::{DocumentError, DocumentStore, Node, Result, Snapshot, StyleNode};
use serde_json::Value;
use std::collections::BTreeMap;

// These are the parameters owned by Style application, not an input allowlist.
// Content, identity and parent placement remain untouched.
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

/// Return an independent module with the recipe's managed parameters.
/// Child recipes are selected by position; unmatched children remain unchanged.
pub fn apply_style(image: &Node, style: &StyleNode) -> Result<Node> {
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
    Ok(result)
}

impl DocumentStore {
    /// Apply once to the session, retaining version and dirty-state management.
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
