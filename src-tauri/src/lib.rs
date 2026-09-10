mod exifdata;
mod fileops;
mod folders;
mod guard;
mod grouping;
mod media;
mod model;
mod paths;
mod project;
mod scan;
mod scratch;
mod settings;
mod thumbnail;
mod trash;
#[cfg(windows)]
mod wic;

use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(scan::ScanState::default())
        .manage(folders::FolderState::default())
        .manage(folders::ReservedKeys::default())
        .manage(guard::AccessScope::default())
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

            // The app's own storage is always in scope: the trash holds files being restored, and
            // the thumbnail cache is read for every tile including the ones in the trash grid.
            // `allow_internal`, not `allow`: this grant is made before the user has done anything,
            // and counting it as session context turned enforcement on at launch (see guard.rs).
            app.state::<guard::AccessScope>().allow_internal(&app_data);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Empty the scratch-disk folder when the app window is closing (§1). Read the path
            // straight from settings.json (same location the setup step registered) so cleanup
            // needs nothing but the AppHandle. Best-effort: failure to clean never blocks exit.
            if matches!(event, WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed) {
                if let Ok(app_data) = window.app_handle().path().app_data_dir() {
                    let _ = scratch::empty_scratch_from_settings(&app_data.join("settings.json"));
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            scan::scan_folders,
            scan::cancel_scan,
            scan::list_folder_files,
            scan::file_infos,
            thumbnail::ensure_thumbnail,
            thumbnail::clear_thumbnail_cache,
            folders::create_folder,
            folders::add_existing_folder,
            folders::add_existing_folders,
            folders::list_target_folders,
            folders::clear_target_folders,
            folders::adopt_session,
            folders::rename_folder,
            folders::delete_folder,
            folders::set_reserved_keys,
            folders::set_folder_key,
            folders::reorder_folders,
            fileops::move_files,
            fileops::delete_files_permanently,
            fileops::batch_rename,
            fileops::rename_files,
            grouping::group_visual,
            grouping::group_temporal,
            grouping::cancel_grouping,
            trash::trash_files,
            trash::list_trash,
            trash::restore_from_trash,
            trash::trash_stats,
            trash::empty_trash,
            settings::get_settings,
            settings::save_settings,
            settings::reset_settings,
            scratch::empty_scratch,
            media::read_image_data_url,
            media::decode_preview,
            media::rotate_image,
            exifdata::read_exif,
            project::save_project,
            project::load_project,
            project::list_projects,
            project::delete_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
