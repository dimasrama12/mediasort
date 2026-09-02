mod fileops;
mod folders;
mod grouping;
mod model;
mod paths;
mod scan;
mod thumbnail;
mod trash;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(scan::ScanState::default())
        .manage(folders::FolderState::default())
        .setup(|app| {
            let cache_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app_data_dir")
                .join("thumbnails");
            std::fs::create_dir_all(&cache_dir).ok();
            app.manage(thumbnail::ThumbState::new(cache_dir));

            let trash_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app_data_dir")
                .join("trash");
            std::fs::create_dir_all(&trash_dir).ok();
            app.manage(trash::TrashState::new(trash_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            scan::scan_folders,
            scan::cancel_scan,
            thumbnail::ensure_thumbnail,
            thumbnail::clear_thumbnail_cache,
            folders::create_folder,
            folders::list_target_folders,
            folders::rename_folder,
            folders::delete_folder,
            fileops::move_files,
            fileops::batch_rename,
            grouping::group_visual,
            grouping::group_temporal,
            trash::trash_files,
            trash::list_trash,
            trash::restore_from_trash,
            trash::trash_stats,
            trash::empty_trash
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
