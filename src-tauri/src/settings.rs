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
pub fn save_to(path: &Path, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
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
