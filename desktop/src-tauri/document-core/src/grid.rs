//! Container grid mutations keep content identity and placement separate.
use crate::{DocumentError, DocumentStore, Node, Result, Snapshot};

pub(super) fn find_node_mut<'a>(nodes: &'a mut [Node], id: &str) -> Option<&'a mut Node> {
    fn visit<'a>(node: &'a mut Node, id: &str) -> Option<&'a mut Node> {
        if node.id == id {
            return Some(node);
        }
        for placed in &mut node.children {
            if let Some(found) = visit(&mut placed.module, id) {
                return Some(found);
            }
        }
        None
    }
    for node in nodes {
        if let Some(found) = visit(node, id) {
            return Some(found);
        }
    }
    None
}

impl DocumentStore {
    /// Shrinking a grid never relocates or deletes modules implicitly.
    pub fn set_module_layout(
        &mut self,
        id: &str,
        expected: u64,
        parent_id: &str,
        layout: (u32, u32),
    ) -> Result<Snapshot> {
        let session = self.session(id)?;
        session.require_version(expected)?;
        let mut document = session.state.document.clone();
        let parent = find_node_mut(&mut document.modules, parent_id)
            .ok_or_else(|| DocumentError::new("NODE_NOT_FOUND", parent_id))?;
        parent.layout = Some(layout);
        session.commit(document)
    }

    /// Compatibility name for existing callers; no module type is implied.
    #[deprecated(note = "Use set_module_layout; layout is a module property")]
    pub fn set_group_layout(
        &mut self,
        id: &str,
        expected: u64,
        module_id: &str,
        layout: (u32, u32),
    ) -> Result<Snapshot> {
        self.set_module_layout(id, expected, module_id, layout)
    }

    /// Move a direct child within its current grid. Cross-container moves are separate work.
    pub fn set_module_position(
        &mut self,
        id: &str,
        expected: u64,
        parent_id: &str,
        module_id: &str,
        position: (u32, u32),
    ) -> Result<Snapshot> {
        let session = self.session(id)?;
        session.require_version(expected)?;
        let mut document = session.state.document.clone();
        let parent = find_node_mut(&mut document.modules, parent_id)
            .ok_or_else(|| DocumentError::new("NODE_NOT_FOUND", parent_id))?;
        let placed = parent
            .children
            .iter_mut()
            .find(|placed| placed.module.id == module_id)
            .ok_or_else(|| DocumentError::new("CHILD_NOT_FOUND", module_id))?;
        placed.position = position;
        session.commit(document)
    }
}
