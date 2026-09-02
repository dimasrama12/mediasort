mod fileops;
mod folders;
mod grouping;
mod model;
mod paths;
mod project;
mod scan;
mod settings;
mod thumbnail;
mod trash;

use tauri::Manager;

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

            let app_data = app.path().app_data_dir().expect("resolve app_data_dir");
            std::fs::create_dir_all(&app_data).ok();
            app.manage(settings::SettingsState::new(app_data.join("settings.json")));

            let projects_dir = app_data.join("projects");
            std::fs::create_dir_all(&projects_dir).ok();
            app.manage(project::ProjectState::new(projects_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            trash::empty_trash,
            settings::get_settings,
            settings::save_settings,
            settings::reset_settings,
            project::save_project,
            project::load_project,
            project::list_projects,
            project::delete_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
