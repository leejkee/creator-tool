mod documents;

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
            documents::open_document,
            documents::get_document,
            documents::list_documents,
            documents::replace_document,
            documents::patch_document_node,
            documents::save_document,
            documents::check_document_file,
            documents::reload_document,
            documents::close_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
