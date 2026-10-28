mod documents;
mod fonts;
mod render_assets;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(documents::Documents::default())
        .setup(|app| {
            documents::start_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            fonts::list_local_font_families,
            render_assets::read_render_asset,
            render_assets::get_render_asset_version,
            documents::open_document,
            documents::create_document,
            documents::save_document_as,
            documents::get_document,
            documents::list_documents,
            documents::replace_document,
            documents::patch_document_node,
            documents::set_group_layout,
            documents::set_module_position,
            documents::apply_module_style,
            documents::apply_document_style,
            documents::save_document,
            documents::check_document_file,
            documents::reload_document,
            documents::close_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
