use std::collections::BTreeSet;

/// Read installed font families, including localized family aliases.
/// A fresh scan lets an explicit UI refresh discover newly installed fonts.
pub(super) fn list_families() -> Vec<String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();

    let mut families = BTreeSet::new();
    for face in database.faces() {
        for (family, _) in &face.families {
            if !family.trim().is_empty() {
                families.insert(family.clone());
            }
        }
    }
    families.into_iter().collect()
}
