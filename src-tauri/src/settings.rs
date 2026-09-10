//! App settings persistence: JSON at `app_data/settings.json`. Pure `load_from`/`save_to`
//! helpers take an explicit path so tests touch only a tempdir; commands resolve the real one.

use crate::model::AppSettings;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// Load settings from `path`, falling back to defaults if it's missing or unparseable.
pub fn load_from(path: &Path) -> AppSettings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Write settings as pretty JSON, creating the parent directory if needed.
///
/// Atomic (temp sibling + rename): `load_from` falls back to defaults on a parse error, so a
/// truncated `settings.json` would silently reset every preference the user ever set.
pub fn save_to(path: &Path, settings: &AppSettings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    crate::fileops::write_atomic(path, json.as_bytes())
}

/// Managed state holding the resolved `settings.json` path.
pub struct SettingsState(pub Mutex<PathBuf>);
impl SettingsState {
    pub fn new(path: PathBuf) -> Self {
        Self(Mutex::new(path))
    }
}

fn path_of(state: &State<'_, SettingsState>) -> Result<PathBuf, String> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> Result<AppSettings, String> {
    Ok(load_from(&path_of(&state)?))
}

#[tauri::command]
pub fn save_settings(state: State<'_, SettingsState>, settings: AppSettings) -> Result<(), String> {
    save_to(&path_of(&state)?, &settings)
}

#[tauri::command]
pub fn reset_settings(state: State<'_, SettingsState>) -> Result<AppSettings, String> {
    let defaults = AppSettings::default();
    save_to(&path_of(&state)?, &defaults)?;
    Ok(defaults)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Theme;

    #[test]
    fn a_settings_file_written_before_scan_subfolders_existed_loads_on_the_safe_default() {
        // Back-compat: an older settings.json has no `scanSubfolders` key at all. It must load
        // (not reset every other preference) and land on the non-recursive behaviour, which is
        // the one that cannot pull already-filed photos back into the library.
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        std::fs::write(
            &p,
            r#"{"similarityThreshold":72,"timeWindowHours":2.0,"minGroupSize":3,"theme":"dark",
                "defaultView":"list","thumbnailSize":180,"sidebarWidth":200,
                "sidebarCollapsed":true,"cachePath":null}"#,
        )
        .unwrap();
        let loaded = load_from(&p);
        assert!(!loaded.scan_subfolders);
        assert_eq!(loaded.similarity_threshold, 72, "the other settings survive");
        assert_eq!(loaded.default_view, "list");
    }

    #[test]
    fn a_settings_file_without_the_sort_flag_loads_on_insertion_order() {
        // Same back-compat guarantee as `scanSubfolders` above: the key is simply absent from a
        // settings.json written before the A-Z toggle existed, and must land on `false` without
        // taking every other preference down with it. The fixture carries every field that has
        // no serde default, because a JSON missing one of those does not parse at all - it would
        // fall back to `AppSettings::default()` and the test would pass for the wrong reason.
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        std::fs::write(
            &p,
            r#"{"similarityThreshold":72,"timeWindowHours":2.0,"minGroupSize":3,"theme":"dark",
                "defaultView":"list","thumbnailSize":180,"sidebarWidth":200,
                "sidebarCollapsed":true,"cachePath":null,"scanSubfolders":true}"#,
        )
        .unwrap();
        let loaded = load_from(&p);
        assert!(!loaded.sort_folders_alphabetically);
        assert_eq!(loaded.similarity_threshold, 72, "the other settings survive");
        assert!(loaded.scan_subfolders);
    }

    #[test]
    fn sort_folders_alphabetically_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let mut s = AppSettings::default();
        s.sort_folders_alphabetically = true;
        save_to(&p, &s).unwrap();
        assert!(load_from(&p).sort_folders_alphabetically);
    }

    #[test]
    fn scan_subfolders_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let mut s = AppSettings::default();
        s.scan_subfolders = true;
        save_to(&p, &s).unwrap();
        assert!(load_from(&p).scan_subfolders);
    }

    #[test]
    fn missing_file_yields_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let s = load_from(&dir.path().join("settings.json"));
        assert_eq!(s, AppSettings::default());
    }

    #[test]
    fn save_then_load_roundtrips_and_creates_parent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/settings.json"); // parent auto-created
        let mut s = AppSettings::default();
        s.similarity_threshold = 65;
        s.time_window_hours = 3.5;
        s.theme = Theme::Dark;
        save_to(&path, &s).unwrap();
        assert!(path.exists());
        assert_eq!(load_from(&path), s);
    }

    #[test]
    fn corrupt_json_yields_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, b"{ not valid json").unwrap();
        assert_eq!(load_from(&path), AppSettings::default());
    }
}
